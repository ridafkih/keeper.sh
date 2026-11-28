import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { OperationDeferralLedger } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider } from "../../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent, PushResult } from "../../../src/core/types";

const WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const makeEvent = (id: string, hour: number): MaterializedSyncableEvent => ({
  calendarId: "source-1",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date(`2026-03-15T${String(hour + 1).padStart(2, "0")}:00:00Z`),
  id,
  sourceEventUid: `uid-${id}`,
  startTime: new Date(`2026-03-15T${String(hour).padStart(2, "0")}:00:00Z`),
  summary: `Event ${id}`,
});

const createMemoryLedger = () => {
  const deferred = new Set<string>();
  const ledger: OperationDeferralLedger = {
    readDeferredOperationKeys: () => Promise.resolve(new Set(deferred)),
    recordOperationOutcomes: ({ failed, succeeded }) => {
      for (const key of succeeded) {
        deferred.delete(key);
      }
      for (const key of failed) {
        deferred.add(key);
      }
      return Promise.resolve();
    },
  };
  return { deferred, ledger };
};

const createProvider = (rejectedEventIds: ReadonlySet<string>) => {
  const pushOrder: string[] = [];
  const provider: CalendarSyncProvider = {
    deleteEvents: (ids) => Promise.resolve(ids.map(() => ({ success: true }))),
    listRemoteEvents: () => Promise.resolve([]),
    pushEvents: (events) => {
      pushOrder.push(...events.map((event) => event.id));
      return Promise.resolve(events.map((event): PushResult => {
        if (rejectedEventIds.has(event.id)) {
          return { error: "Conflict", reason: "conflict", statusCode: 409, success: false };
        }
        return { deleteId: `google-${event.id}`, remoteId: `${event.id}@keeper.sh`, success: true };
      }));
    },
  };
  return { provider, pushOrder };
};

const runSync = (
  provider: CalendarSyncProvider,
  localEvents: MaterializedSyncableEvent[],
  operationDeferral: OperationDeferralLedger,
  onSyncEvent?: (event: Record<string, unknown>) => void,
) => syncCalendar({
  calendarId: "destination-1",
  flush: () => Promise.resolve(),
  isCurrent: () => Promise.resolve(true),
  onSyncEvent,
  operationDeferral,
  provider,
  readState: () => Promise.resolve({ existingMappings: [], localEvents, remoteEvents: [] }),
  reconciliationScope: { authoritativeWindow: WINDOW, requestedWindow: WINDOW },
  userId: "user-1",
});

describe("operations that failed in a recent run", () => {
  const earliest = makeEvent("earliest", 8);
  const later = makeEvent("later", 9);
  const latest = makeEvent("latest", 10);

  it("are remembered after failing and forgotten once they succeed", async () => {
    const { deferred, ledger } = createMemoryLedger();

    await runSync(createProvider(new Set(["earliest"])).provider, [earliest, later], ledger);
    expect([...deferred]).toEqual(["event:earliest"]);

    await runSync(createProvider(new Set()).provider, [earliest, later], ledger);
    expect([...deferred]).toEqual([]);
  });

  it("go behind work not yet attempted so they cannot starve the queue front", async () => {
    const { ledger } = createMemoryLedger();
    const rejected = new Set(["earliest"]);

    const firstRun = createProvider(rejected);
    await runSync(firstRun.provider, [earliest, later], ledger);
    expect(firstRun.pushOrder).toEqual(["earliest", "later"]);

    const secondRun = createProvider(rejected);
    const syncEvents: Record<string, unknown>[] = [];
    await runSync(secondRun.provider, [earliest, latest], ledger, (event) => syncEvents.push(event));
    expect(secondRun.pushOrder).toEqual(["latest", "earliest"]);
    expect(syncEvents[0]?.["operations.deferred_count"]).toBe(1);
  });

  it("keep time order among themselves and among fresh work", async () => {
    const { deferred, ledger } = createMemoryLedger();
    deferred.add("event:earliest");
    deferred.add("event:later");
    const run = createProvider(new Set());

    await runSync(run.provider, [latest, later, earliest, makeEvent("fresh", 11)], ledger);

    expect(run.pushOrder).toEqual(["latest", "fresh", "earliest", "later"]);
  });
});
