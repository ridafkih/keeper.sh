import { describe, expectTypeOf, test } from "vitest";
import type {
  AccountId,
  CalendarEnumeration,
  CalendarProvider,
  ChangeListing,
  EditableContent,
  Instant,
  ListChangesRequest,
  NormalizedContent,
  OperationContext,
  Result,
  RetryBudget,
  WriteIntent,
  WriteOutcome,
} from "../src/index";

declare const now: () => Instant;
declare const signal: AbortSignal;
declare const absentSignal: undefined;
declare const deadline: Instant;
declare const retryBudget: RetryBudget;

declare const acceptContext: (context: OperationContext) => void;
declare const acceptRetryBudget: (budget: RetryBudget) => void;
declare const acceptProvider: (provider: CalendarProvider<"google">) => void;
declare const acceptNormalized: (content: NormalizedContent<"google">) => void;
declare const rawContent: EditableContent;

declare const candidateWithBareWrite: {
  readonly capabilities: CalendarProvider<"google">["capabilities"];
  readonly listCalendars: CalendarProvider<"google">["listCalendars"];
  readonly listChanges: CalendarProvider<"google">["listChanges"];
  readonly normalize: CalendarProvider<"google">["normalize"];
  readonly write: (intent: WriteIntent<"google">) => Promise<WriteOutcome>;
};

declare const candidateThatOnlyCreates: {
  readonly capabilities: CalendarProvider<"google">["capabilities"];
  readonly listCalendars: CalendarProvider<"google">["listCalendars"];
  readonly listChanges: CalendarProvider<"google">["listChanges"];
  readonly normalize: CalendarProvider<"google">["normalize"];
  readonly write: (
    intent: Extract<WriteIntent<"google">, { kind: "create" }>,
    context: OperationContext,
  ) => Promise<Result<WriteOutcome>>;
};

describe("nothing in the contract can wedge", () => {
  test("every awaiting operation takes an OperationContext", () => {
    expectTypeOf<Parameters<CalendarProvider["listCalendars"]>>().toEqualTypeOf<
      [AccountId, OperationContext]
    >();
    expectTypeOf<Parameters<CalendarProvider["listChanges"]>>().toEqualTypeOf<
      [ListChangesRequest, OperationContext]
    >();
    expectTypeOf<Parameters<CalendarProvider["write"]>>().toEqualTypeOf<
      [WriteIntent, OperationContext]
    >();
  });

  test("OperationContext.signal cannot be omitted or undefined", () => {
    expectTypeOf<OperationContext>().toHaveProperty("signal").toEqualTypeOf<AbortSignal>();
    // @ts-expect-error a remote await with no cancellation path is a hang waiting to happen
    acceptContext({ now, deadline, retryBudget });
    // @ts-expect-error an optional signal is a signal somebody will forget to pass
    acceptContext({ signal: absentSignal, now, deadline, retryBudget });
  });

  test("an operation cannot be started without a wall-clock deadline", () => {
    // @ts-expect-error a socket nobody aborts and nobody times out is the hang we keep shipping
    acceptContext({ signal, now, retryBudget });
    expectTypeOf<OperationContext["deadline"]>().toEqualTypeOf<Instant>();
  });

  test("an OperationContext cannot be constructed without a retry budget", () => {
    // @ts-expect-error retries left to the adapter's discretion are where the ceiling gets lost
    acceptContext({ signal, now, deadline });
  });

  test("a RetryBudget without maxAttempts does not compile", () => {
    // @ts-expect-error an unbounded retry loop burns an hour of quota per calendar
    acceptRetryBudget({ retryDelayCeilingMs: 64_000 });
    expectTypeOf<RetryBudget["maxAttempts"]>().toEqualTypeOf<number>();
    expectTypeOf<RetryBudget["retryDelayCeilingMs"]>().toEqualTypeOf<number>();
  });

  test("no awaiting method returns a bare value; every one returns a Result", () => {
    expectTypeOf<CalendarProvider["listCalendars"]>().returns.toEqualTypeOf<
      Promise<Result<CalendarEnumeration>>
    >();
    expectTypeOf<CalendarProvider["listChanges"]>().returns.toEqualTypeOf<
      Promise<Result<ChangeListing>>
    >();
    expectTypeOf<CalendarProvider["write"]>().returns.toEqualTypeOf<
      Promise<Result<WriteOutcome>>
    >();
    expectTypeOf<CalendarProvider["normalize"]>().returns.toEqualTypeOf<
      Result<NormalizedContent<string>>
    >();
  });

  test("a provider whose write resolves a bare outcome does not satisfy the contract", () => {
    // @ts-expect-error a thrown or untyped failure is how reauth became an infinite retry
    acceptProvider(candidateWithBareWrite);
  });

  test("a provider that handles only some intent kinds does not satisfy the contract", () => {
    // @ts-expect-error method bivariance would let an adapter quietly ignore delete and retire
    acceptProvider(candidateThatOnlyCreates);
  });

  test("normalization is a declared phase of the contract", () => {
    expectTypeOf<Parameters<CalendarProvider["normalize"]>>().toEqualTypeOf<[EditableContent]>();
    // @ts-expect-error only provider.normalize may mint normalized content
    acceptNormalized(rawContent);
  });
});
