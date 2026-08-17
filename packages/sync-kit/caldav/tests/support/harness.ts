import type { ConformanceEnvironment } from "@keeper.sh/sync-conformance";
import { conformanceHash, createConformanceEnvironment } from "@keeper.sh/sync-conformance";
import { createZoneCache } from "@keeper.sh/sync-ical";
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
import type { DAVClient } from "tsdav";
import { createCalDAVClient } from "../../src/client/dav-client";
import type {
  CalDAVAuthMethod,
  CalDAVCredentials,
  CalDAVDependencies,
} from "../../src/dependencies";
import { caldavLimits } from "../../src/limits";
import { createCalDAVProvider } from "../../src/provider";
import type { FakeCalDAV, FakeCalDAVOptions } from "./fake-caldav";
import { calendarPath, createFakeCalDAV, secondCalendarPath, serverUrl } from "./fake-caldav";

const suiteStart: Instant = { kind: "instant", value: "2026-03-11T00:00:00.000Z" };

const caldavAccount: AccountId = { kind: "accountId", value: "dav.example.com/principals/users/alice" };
const secondAccount: AccountId = { kind: "accountId", value: "dav.example.com/principals/users/bob" };

const caldavCalendar: CalendarKey = {
  provider: "caldav",
  account: caldavAccount,
  calendar: { kind: "calendarId", value: calendarPath },
};

const secondCalendar: CalendarKey = {
  provider: "caldav",
  account: caldavAccount,
  calendar: { kind: "calendarId", value: secondCalendarPath },
};

const secondAccountCalendar: CalendarKey = {
  provider: "caldav",
  account: secondAccount,
  calendar: { kind: "calendarId", value: calendarPath },
};

const caldavWritableCalendar: WritableCalendar = { key: caldavCalendar, access: "readWrite" };

const marchWindow: TimeWindow = {
  start: { kind: "instant", value: "2026-03-01T00:00:00.000Z" },
  end: { kind: "instant", value: "2026-04-01T00:00:00.000Z" },
};

const decadeWindow: TimeWindow = {
  start: { kind: "instant", value: "2020-01-01T00:00:00.000Z" },
  end: { kind: "instant", value: "2030-01-01T00:00:00.000Z" },
};

const scopeOver = (window: TimeWindow, calendar: CalendarKey = caldavCalendar): ListingScope => ({
  calendar,
  window,
  expandRecurrences: false,
});

const credentials: CalDAVCredentials = {
  serverUrl,
  username: "alice",
  password: "correct horse",
  knownAuthMethod: null,
};

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

const resolvedAuthMethods: CalDAVAuthMethod[] = [];

const recordResolvedMethod = (method: CalDAVAuthMethod): void => {
  resolvedAuthMethods.push(method);
};

const clientOver = (
  fake: FakeCalDAV,
  using: CalDAVCredentials = credentials,
  onAuthMethodResolved: (method: CalDAVAuthMethod) => void = recordResolvedMethod,
): DAVClient =>
  createCalDAVClient({ fetch: fake.fetch, credentials: using, onAuthMethodResolved });

interface HarnessOptions {
  readonly collectionConcurrency?: number;
  readonly credentials?: CalDAVCredentials;
  readonly fake?: Partial<FakeCalDAVOptions>;
  readonly resources?: readonly { path: string; data: string }[];
}

const caldavDependenciesOver = (
  environment: ConformanceEnvironment,
  fake: FakeCalDAV,
  options: HarnessOptions = {},
): CalDAVDependencies => ({
  client: clientOver(fake, options.credentials ?? credentials),
  credentials: options.credentials ?? credentials,
  clock: environment.clock,
  gate: environment.transport.run,
  hash: environment.hash,
  installation: environment.installation,
  zones: createZoneCache(),
  collectionConcurrency: options.collectionConcurrency ?? caldavLimits.collectionConcurrency,
});

interface Harness {
  readonly environment: ConformanceEnvironment;
  readonly fake: FakeCalDAV;
  readonly dependencies: CalDAVDependencies;
  readonly provider: CalendarProvider<"caldav">;
}

const createHarness = (options: HarnessOptions = {}): Harness => {
  const environment = createConformanceEnvironment({
    start: suiteStart,
    installation: { kind: "installationId", value: "caldav-tests" },
    hash: conformanceHash,
  });
  const fake = createFakeCalDAV({ options: options.fake, resources: options.resources });
  const dependencies = caldavDependenciesOver(environment, fake, options);
  return { environment, fake, dependencies, provider: createCalDAVProvider(dependencies) };
};

export {
  caldavAccount,
  caldavCalendar,
  caldavDependenciesOver,
  caldavWritableCalendar,
  clientOver,
  createHarness,
  credentials,
  decadeWindow,
  marchWindow,
  neverAborts,
  operationContext,
  scopeOver,
  secondAccount,
  secondAccountCalendar,
  secondCalendar,
  suiteStart,
};
export type { ContextOptions, Harness, HarnessOptions };
