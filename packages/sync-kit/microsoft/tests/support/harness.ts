import type { ConformanceEnvironment } from "@keeper.sh/sync-conformance";
import { conformanceHash, createConformanceEnvironment } from "@keeper.sh/sync-conformance";
import type {
  AccountId,
  CalendarKey,
  CalendarProvider,
  Instant,
  ListingScope,
  OperationContext,
  TimeWindow,
  WritableCalendar,
} from "@keeper.sh/sync-protocol";
import type { MicrosoftDependencies } from "../../src/dependencies";
import { microsoftLimits } from "../../src/limits";
import { createMicrosoftProvider } from "../../src/provider";
import type { FakeGraph } from "./fake-graph";
import { createFakeGraph } from "./fake-graph";
import { graphClientOver } from "./graph";

const suiteStart: Instant = { kind: "instant", value: "2026-03-11T00:00:00.000Z" };

const microsoftAccount: AccountId = { kind: "accountId", value: "mailbox-one" };
const secondMailbox: AccountId = { kind: "accountId", value: "mailbox-two" };

const microsoftCalendar: CalendarKey = {
  provider: "microsoft",
  account: microsoftAccount,
  calendar: { kind: "calendarId", value: "AAMkAGVmMDEz" },
};

const secondMailboxCalendar: CalendarKey = {
  provider: "microsoft",
  account: secondMailbox,
  calendar: { kind: "calendarId", value: "AAMkAGVmMDE0" },
};

const microsoftWritableCalendar: WritableCalendar = {
  key: microsoftCalendar,
  access: "readWrite",
};

const marchWindow: TimeWindow = {
  start: { kind: "instant", value: "2026-03-01T00:00:00.000Z" },
  end: { kind: "instant", value: "2026-04-01T00:00:00.000Z" },
};

const decadeWindow: TimeWindow = {
  start: { kind: "instant", value: "2020-01-01T00:00:00.000Z" },
  end: { kind: "instant", value: "2030-01-01T00:00:00.000Z" },
};

const scopeOver = (window: TimeWindow, calendar: CalendarKey = microsoftCalendar): ListingScope => ({
  calendar,
  window,
  expandRecurrences: false,
});

interface ContextOptions {
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
  readonly maxAttempts?: number;
  readonly retryDelayCeilingMs?: number;
}

const neverAborts = (): AbortSignal => new AbortController().signal;

const operationContext = (
  environment: ConformanceEnvironment,
  options: ContextOptions = {},
): OperationContext => {
  const now = environment.clock.now();
  const budget = options.deadlineMs ?? 250;
  return {
    signal: options.signal ?? neverAborts(),
    now: environment.clock.now,
    deadline: { kind: "instant", value: new Date(Date.parse(now.value) + budget).toISOString() },
    retryBudget: {
      maxAttempts: options.maxAttempts ?? 1,
      retryDelayCeilingMs: options.retryDelayCeilingMs ?? 1,
    },
  };
};

interface HarnessOptions {
  readonly mailboxConcurrency?: number;
  readonly randomFraction?: () => number;
}

const microsoftDependenciesOver = (
  environment: ConformanceEnvironment,
  fake: FakeGraph,
  options: HarnessOptions = {},
): MicrosoftDependencies => ({
  graph: graphClientOver(fake.fetch),
  clock: environment.clock,
  gate: environment.transport.run,
  hash: environment.hash,
  installation: environment.installation,
  mailboxConcurrency: options.mailboxConcurrency ?? microsoftLimits.mailboxConcurrency,
  randomFraction: options.randomFraction ?? (() => 0.5),
});

interface Harness {
  readonly environment: ConformanceEnvironment;
  readonly fake: FakeGraph;
  readonly dependencies: MicrosoftDependencies;
  readonly provider: CalendarProvider<"microsoft">;
}

const createHarness = (options: HarnessOptions = {}): Harness => {
  const environment = createConformanceEnvironment({
    start: suiteStart,
    installation: { kind: "installationId", value: "microsoft-tests" },
    hash: conformanceHash,
  });
  const fake = createFakeGraph({
    installation: environment.installation,
    account: microsoftAccount.value,
    calendarId: microsoftCalendar.calendar.value,
    startedAt: suiteStart.value,
  });
  const dependencies = microsoftDependenciesOver(environment, fake, options);
  return { environment, fake, dependencies, provider: createMicrosoftProvider(dependencies) };
};

export {
  createHarness,
  decadeWindow,
  marchWindow,
  microsoftAccount,
  microsoftCalendar,
  microsoftDependenciesOver,
  microsoftWritableCalendar,
  operationContext,
  scopeOver,
  secondMailbox,
  secondMailboxCalendar,
  suiteStart,
};
export type { ContextOptions, Harness, HarnessOptions };
