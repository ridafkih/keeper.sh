import { auth } from "@googleapis/calendar";
import type { ConformanceEnvironment } from "@keeper.sh/sync-conformance";
import { conformanceHash, createConformanceEnvironment } from "@keeper.sh/sync-conformance";
import type {
  CalendarKey,
  CalendarProvider,
  Instant,
  ListingScope,
  OperationContext,
  TimeWindow,
  WritableCalendar,
} from "@keeper.sh/sync-protocol";
import { createGoogleClient } from "../../src/client/calendar-client";
import type { GoogleDependencies } from "../../src/dependencies";
import { createGoogleProvider } from "../../src/provider";
import type { FakeGoogle } from "./fake-google";
import { createFakeGoogle } from "./fake-google";

const suiteStart: Instant = { kind: "instant", value: "2026-03-11T00:00:00.000Z" };

const googleCalendar: CalendarKey = {
  provider: "google",
  account: { kind: "accountId", value: "google-account" },
  calendar: { kind: "calendarId", value: "primary" },
};

const googleWritableCalendar: WritableCalendar = { key: googleCalendar, access: "readWrite" };

const marchWindow: TimeWindow = {
  start: { kind: "instant", value: "2026-03-01T00:00:00.000Z" },
  end: { kind: "instant", value: "2026-04-01T00:00:00.000Z" },
};

const decadeWindow: TimeWindow = {
  start: { kind: "instant", value: "2020-01-01T00:00:00.000Z" },
  end: { kind: "instant", value: "2030-01-01T00:00:00.000Z" },
};

const scopeOver = (window: TimeWindow): ListingScope => ({
  calendar: googleCalendar,
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

interface Harness {
  readonly environment: ConformanceEnvironment;
  readonly fake: FakeGoogle;
  readonly dependencies: GoogleDependencies;
  readonly provider: CalendarProvider<"google">;
}

interface HarnessOptions {
  readonly timeoutMs?: number;
}

const authorizedClient = (): InstanceType<typeof auth.OAuth2> => {
  const client = new auth.OAuth2({ clientId: "fake", clientSecret: "fake" });
  client.setCredentials({ access_token: "fake-access-token" });
  return client;
};

const googleDependenciesOver = (
  environment: ConformanceEnvironment,
  fake: FakeGoogle,
  options: HarnessOptions,
): GoogleDependencies => {
  let issued = 0;
  return {
    calendar: createGoogleClient({
      fetch: fake.fetch,
      auth: authorizedClient(),
      timeoutMs: options.timeoutMs ?? 5000,
    }),
    clock: environment.clock,
    gate: environment.transport.run,
    hash: environment.hash,
    installation: environment.installation,
    concurrency: environment.concurrency,
    randomId: () => {
      issued += 1;
      return `random-${issued}`;
    },
    randomFraction: () => 0.5,
  };
};

const createHarness = (options: HarnessOptions = {}): Harness => {
  const environment = createConformanceEnvironment({
    start: suiteStart,
    installation: { kind: "installationId", value: "google-tests" },
    hash: conformanceHash,
  });
  const fake = createFakeGoogle({
    installation: environment.installation,
    calendarId: googleCalendar.calendar.value,
    startedAt: suiteStart.value,
  });
  const dependencies = googleDependenciesOver(environment, fake, options);
  return { environment, fake, dependencies, provider: createGoogleProvider(dependencies) };
};

export {
  createHarness,
  decadeWindow,
  googleCalendar,
  googleDependenciesOver,
  googleWritableCalendar,
  marchWindow,
  operationContext,
  scopeOver,
  suiteStart,
};
export type { ContextOptions, Harness, HarnessOptions };
