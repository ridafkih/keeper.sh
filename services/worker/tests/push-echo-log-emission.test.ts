import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { widelog, widelogger } from "widelogger";
import { syncCalendar } from "@keeper.sh/calendar";
import type {
  DeleteResult,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "@keeper.sh/calendar";
import { applySyncEventFields } from "../src/utils/sync-event-fields";

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
  id,
  sourceEventUid: `uid-${id}`,
  startTime: new Date("2026-03-15T09:00:00Z"),
  endTime: new Date("2026-03-15T10:00:00Z"),
  summary: `Event ${id}`,
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
});

const runRealSync = async (): Promise<Record<string, unknown>> => {
  const emitted: Record<string, unknown>[] = [];
  const echoes: PushResult["echo"][] = [
    {
      comparable: true,
      divergence: {
        allDay: false,
        description: true,
        end: false,
        location: false,
        start: true,
        summary: false,
      },
    },
    { comparable: false, reason: "echo-body-missing" },
  ];
  const provider = {
    deleteEvents: (eventIds: string[]): Promise<DeleteResult[]> =>
      Promise.resolve(eventIds.map(() => ({ success: true }))),
    listRemoteEvents: (): Promise<RemoteEvent[]> => Promise.resolve([]),
    pushEvents: (events: MaterializedSyncableEvent[]): Promise<PushResult[]> =>
      Promise.resolve(events.map((event, index): PushResult => ({
        deleteId: `delete-${event.id}`,
        echo: echoes[index],
        remoteId: `remote-${event.id}`,
        success: true,
      }))),
  };

  await syncCalendar({
    calendarId: "dest-cal-1",
    flush: () => Promise.resolve(),
    isCurrent: () => Promise.resolve(true),
    onSyncEvent: (event) => { emitted.push(event); },
    provider,
    readState: () => Promise.resolve({
      existingMappings: [],
      localEvents: [makeEvent("ev-1"), makeEvent("ev-2")],
      remoteEvents: [],
    }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });

  const [event] = emitted;
  expect(emitted).toHaveLength(1);
  return event as Record<string, unknown>;
};

describe("push echo log emission", () => {
  it("lands the push echo counters on the emitted wide event line", async () => {
    const wideEvent = await runRealSync();

    const logPath = join(mkdtempSync(join(tmpdir(), "push-echo-log-")), "wide.log");
    const { context, destroy } = widelogger({
      defaultEventName: "wide_event",
      service: "keeper-worker-test",
      transport: { options: { destination: logPath }, target: "pino/file" },
    });
    await context(() => {
      applySyncEventFields(wideEvent);
      widelog.flush();
      return Promise.resolve();
    });
    await destroy();

    let raw = "";
    for (let attempt = 0; attempt < 50 && raw === ""; attempt++) {
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      raw = readFileSync(logPath, "utf8").trim();
    }
    const lines = raw.split("\n");
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const emittedLine = parsed.find((line) => Boolean(line["push_echo"]));

    expect(emittedLine).toBeDefined();
    const pushEcho = emittedLine?.["push_echo"] as Record<string, unknown>;
    expect(pushEcho["compared_count"]).toBe(1);
    expect(pushEcho["uncomparable_count"]).toBe(1);
    expect(pushEcho["changed_count"]).toBe(1);
    expect(pushEcho["description_changed_count"]).toBe(1);
    expect(pushEcho["start_changed_count"]).toBe(1);
    expect(pushEcho["summary_changed_count"]).toBeUndefined();

    const serialized = JSON.stringify(emittedLine);
    expect(serialized).not.toContain("Event ev-1");
  });
});
