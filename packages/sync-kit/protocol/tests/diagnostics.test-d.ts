import { describe, expectTypeOf, test } from "vitest";
import type {
  BoundedSample,
  EventUid,
  ListingDiagnostics,
  RemoteEventId,
  WithheldEvent,
  WithholdReason,
} from "../src/index";

declare const identifiers: readonly string[];
declare const sample: BoundedSample;
declare const remoteEventId: RemoteEventId;
declare const eventUid: EventUid;
declare const acceptWithheld: (withheld: WithheldEvent) => void;

declare const acceptSample: (bounded: BoundedSample) => void;
declare const acceptDiagnostics: (diagnostics: ListingDiagnostics) => void;
declare const acceptBoundedShape: (bounded: {
  readonly sample: readonly string[];
  readonly total: number;
}) => void;

describe("a discard always leaves a trace that survives truncation", () => {
  test("an identifier diagnostic is never a bare array", () => {
    // @ts-expect-error an uncapped list pushes the wide event past its size limit
    acceptSample(identifiers);
    expectTypeOf<BoundedSample>().toEqualTypeOf<{
      readonly sample: readonly string[];
      readonly total: number;
    }>();
  });

  test("the counters are required, not optional", () => {
    // @ts-expect-error an adapter must answer how many of its own events it saw
    acceptDiagnostics({ withheld: sample, unrepresentable: sample, pagesFetched: 3 });
    expectTypeOf<ListingDiagnostics["pagesFetched"]>().toEqualTypeOf<number>();
  });

  test("selfAuthored and unrepresentable are separate counters", () => {
    expectTypeOf<keyof ListingDiagnostics>().toEqualTypeOf<
      "withheld" | "selfAuthored" | "unrepresentable" | "pagesFetched"
    >();
  });

  test("a bounded sample keeps the total beside the sample it truncated", () => {
    acceptBoundedShape(sample);
  });

  test("a publisher that stripped the UID before deleting still has a withheld shape", () => {
    acceptWithheld({ uid: null, id: remoteEventId, reason: "missingIdentity" });
    acceptWithheld({ uid: eventUid, id: null, reason: "unparseable" });
    // @ts-expect-error an event nothing can name cannot be counted, so it would be silently dropped
    acceptWithheld({ uid: null, id: null, reason: "missingIdentity" });
  });

  test("a recurrence range an adapter refuses to reinterpret is a named reason", () => {
    expectTypeOf<"unsupportedRecurrenceRange" | "missingIdentity">().toExtend<WithholdReason>();
  });
});
