import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AccountThrottlePolicy } from "@keeper.sh/constants";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { PendingChanges } from "../../../src/core/sync-engine/types";
import type { EventMapping, MaterializedSyncableEvent } from "../../../src/index";
import { AccountThrottledError, createAdaptiveAccountLimiter } from "../../../src/core/utils/adaptive-account-throttle";
import type { RedisScriptClient } from "../../../src/core/utils/redis-rate-limiter";
import { createCalDAVSyncProvider } from "../../../src/providers/caldav/destination/provider";
import {
  createRenamingCalDAVServer,
  RENAMING_CALENDAR_URL,
} from "../../providers/caldav/shared/fake-renaming-caldav";

const WINDOW = {
  timeMax: new Date("2028-01-01T00:00:00.000Z"),
  timeMin: new Date("2026-01-01T00:00:00.000Z"),
};

const SCOPE = { authoritativeWindow: WINDOW, requestedWindow: WINDOW };

const POLICY: AccountThrottlePolicy = {
  initialCooldownMs: 30_000,
  jitterRatio: 0,
  maximumCooldownMs: 900_000,
  maximumParkMs: 15_000,
  minimumRequestsPerMinute: 15,
  recoveryWindowMs: 600_000,
  requestsPerMinute: 240,
};

const RETRY_AFTER_SECONDS = 120;
const WRITES_BEFORE_THROTTLE = 4;
const EVENT_COUNT = 12;

const buildEvent = (index: number): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: "source-calendar",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date(`2027-03-${String(index + 1).padStart(2, "0")}T17:00:00.000Z`),
  eventStateId: `event-state-${index}`,
  id: `event-state-${index}`,
  sourceEventUid: `source-uid-${index}`,
  startTime: new Date(`2027-03-${String(index + 1).padStart(2, "0")}T16:00:00.000Z`),
  startTimeZone: "UTC",
  summary: `Event ${index}`,
} as MaterializedSyncableEvent);

const applyChanges = (mappings: EventMapping[], changes: PendingChanges): void => {
  for (const insert of changes.inserts) {
    mappings.push({ ...insert, id: `mapping-${insert.syncEventId}-${mappings.length}` } as EventMapping);
  }
  for (const deleted of changes.deletes) {
    const index = mappings.findIndex((mapping) => mapping.id === deleted);
    if (index !== -1) {
      mappings.splice(index, 1);
    }
  }
};

const createScriptRedis = (): RedisScriptClient => {
  const values = new Map<string, string>();
  return {
    eval: (script: string, _keys: number, ...args: string[]) => {
      const [key = "", value = ""] = args;
      if (script.includes("'SET'")) {
        values.set(key, value);
        return Promise.resolve(1);
      }
      if (script.includes("'GET'")) {
        return Promise.resolve(values.get(key) ?? null);
      }
      return Promise.resolve([0, 0]);
    },
  };
};

interface ThrottlingServer {
  fetch: typeof globalThis.fetch;
  puts: () => number;
  requestsWhileThrottled: () => number;
  storedCount: () => number;
}

const createThrottlingServer = (now: () => number): ThrottlingServer => {
  const inner = createRenamingCalDAVServer({ resolvesClientNames: true });
  let acceptedPuts = 0;
  let throttledUntil = 0;
  let requestsWhileThrottled = 0;

  const throttle = (): Response => {
    requestsWhileThrottled += 1;
    return new Response(null, {
      headers: { "Retry-After": String(RETRY_AFTER_SECONDS) },
      status: 503,
      statusText: "Service Unavailable",
    });
  };

  const fetch = ((input: string | Request | URL, init?: RequestInit) => {
    if (now() < throttledUntil) {
      return Promise.resolve(throttle());
    }
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT") {
      if (acceptedPuts >= WRITES_BEFORE_THROTTLE && throttledUntil === 0) {
        throttledUntil = now() + RETRY_AFTER_SECONDS * 1000;
        return Promise.resolve(throttle());
      }
      acceptedPuts += 1;
    }
    return inner.fetch(input, init);
  }) as typeof globalThis.fetch;

  return {
    fetch,
    puts: () => inner.writes.length,
    requestsWhileThrottled: () => requestsWhileThrottled,
    storedCount: () => inner.names().length,
  };
};

let originalFetch: typeof globalThis.fetch = globalThis.fetch;
let current = Date.parse("2026-11-23T22:31:00.000Z");
const clock = { now: () => current };

beforeEach(() => {
  originalFetch = globalThis.fetch;
  current = Date.parse("2026-11-23T22:31:00.000Z");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("an iCloud account that starts throttling partway through a burst of writes", () => {
  it("stops sending at the first throttle, waits out the cooldown, then writes only what is left", async () => {
    const server = createThrottlingServer(clock.now);
    globalThis.fetch = server.fetch;
    const redis = createScriptRedis();
    const events = Array.from({ length: EVENT_COUNT }, (_unused, index) => buildEvent(index));
    const mappings: EventMapping[] = [];

    const runSync = async (): Promise<Record<string, unknown>> => {
      const provider = createCalDAVSyncProvider({
        authMethod: "basic",
        calendarUrl: RENAMING_CALENDAR_URL,
        destinationCalendarId: "destination-calendar",
        password: "password",
        rateLimiter: createAdaptiveAccountLimiter(redis, "ratelimit:caldav-account:a", POLICY, {
          now: clock.now,
          random: () => 0,
          sleep: (milliseconds) => {
            current += milliseconds;
            return Promise.resolve();
          },
        }),
        serverUrl: RENAMING_CALENDAR_URL,
        username: "someone",
      });
      const emitted: Record<string, unknown>[] = [];
      await syncCalendar({
        calendarId: "destination-calendar",
        flush: (changes) => {
          applyChanges(mappings, changes);
          return Promise.resolve();
        },
        isCurrent: () => Promise.resolve(true),
        onSyncEvent: (wideEvent) => emitted.push(wideEvent),
        provider,
        readState: async () => ({
          existingMappings: mappings.map((mapping) => ({ ...mapping })),
          localEvents: events,
          remoteEvents: await provider.listRemoteEvents(WINDOW),
        }),
        reconciliationScope: SCOPE,
        userId: "user-1",
      });
      return emitted[0] ?? {};
    };

    const burst = await runSync();

    expect(burst["events.added"]).toBe(WRITES_BEFORE_THROTTLE);
    expect(burst["operation_errors.add.reason.account_cooling_down"]).toBe(EVENT_COUNT - WRITES_BEFORE_THROTTLE);
    expect(server.requestsWhileThrottled()).toBe(1);

    current += 60_000;
    await expect(runSync()).rejects.toBeInstanceOf(AccountThrottledError);
    expect(server.requestsWhileThrottled()).toBe(1);

    current += RETRY_AFTER_SECONDS * 1000;
    const resumed = await runSync();
    const settled = await runSync();

    expect(resumed["events.added"]).toBe(EVENT_COUNT - WRITES_BEFORE_THROTTLE);
    expect(resumed["events.add_failed"]).toBe(0);
    expect(settled["operations.total"]).toBe(0);
    expect(server.storedCount()).toBe(EVENT_COUNT);
    expect(server.puts()).toBe(EVENT_COUNT);
    expect(server.requestsWhileThrottled()).toBe(1);
  });
});
