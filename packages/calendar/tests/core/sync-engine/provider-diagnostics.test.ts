import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type {
  DeleteResult,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../../src/core/types";
import type { CalendarSyncProvider } from "../../../src/core/sync-engine/types";

const TEST_RECONCILIATION_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const makeEvent = (id: string): MaterializedSyncableEvent => ({
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00Z"),
  id,
  sourceEventUid: `uid-${id}`,
  startTime: new Date("2026-03-15T09:00:00Z"),
  summary: `Event ${id}`,
});

const makeProvider = (overrides: Partial<CalendarSyncProvider> = {}): CalendarSyncProvider => ({
  deleteEvents: (): Promise<DeleteResult[]> => Promise.resolve([]),
  listRemoteEvents: (): Promise<RemoteEvent[]> => Promise.resolve([]),
  pushEvents: (): Promise<PushResult[]> => Promise.resolve([]),
  ...overrides,
});

const runSync = async (options: {
  localEvents?: MaterializedSyncableEvent[];
  provider: CalendarSyncProvider;
  readState?: () => Promise<never>;
}): Promise<Record<string, unknown>> => {
  const emitted: Record<string, unknown>[] = [];
  const run = syncCalendar({
    calendarId: "dest-cal-1",
    flush: () => Promise.resolve(),
    isCurrent: () => Promise.resolve(true),
    onSyncEvent: (event) => { emitted.push(event); },
    provider: options.provider,
    readState: options.readState ?? (() => Promise.resolve({
      existingMappings: [],
      localEvents: options.localEvents ?? [],
      remoteEvents: [],
    })),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });
  await run.catch(() => null);

  expect(emitted).toHaveLength(1);
  return emitted[0] as Record<string, unknown>;
};

describe("syncCalendar provider diagnostics", () => {
  it("carries provider-reported diagnostics into the wide event", async () => {
    const event = await runSync({
      localEvents: [makeEvent("ev-1")],
      provider: makeProvider({
        getSyncDiagnostics: () => ({
          "events.remove_not_found": 3,
          "provider.caldav.host": "caldav.example.com",
          "remote_objects.listed_count": 900,
          "remote_objects.requested_count": 12,
        }),
        pushEvents: () => Promise.resolve([{ remoteId: "remote-1", success: true }]),
      }),
    });

    expect(event).toMatchObject({
      "events.remove_not_found": 3,
      "outcome": "success",
      "provider.caldav.host": "caldav.example.com",
      "remote_objects.listed_count": 900,
      "remote_objects.requested_count": 12,
    });
  });

  it("carries diagnostics on an in-sync run so a listing can be measured without any operations", async () => {
    const event = await runSync({
      provider: makeProvider({
        getSyncDiagnostics: () => ({
          "remote_objects.listed_count": 900,
          "remote_objects.requested_count": 12,
        }),
      }),
    });

    expect(event).toMatchObject({
      "outcome": "in-sync",
      "remote_objects.listed_count": 900,
      "remote_objects.requested_count": 12,
    });
  });

  it("carries diagnostics on a failed run, where they explain the failure", async () => {
    const event = await runSync({
      provider: makeProvider({
        getSyncDiagnostics: () => ({ "remote_objects.unrequested_count": 900 }),
      }),
      readState: () => Promise.reject(new Error("read failed")),
    });

    expect(event).toMatchObject({
      "outcome": "error",
      "remote_objects.unrequested_count": 900,
    });
  });

  it("emits nothing extra for a provider that reports no diagnostics", async () => {
    const event = await runSync({ provider: makeProvider() });

    expect(Object.keys(event).some((key) => key.startsWith("remote_objects."))).toBe(false);
  });
});
