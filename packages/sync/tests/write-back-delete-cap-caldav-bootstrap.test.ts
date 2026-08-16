import { describe, expect, it } from "vitest";
import { createCalDAVSourceWriter } from "@keeper.sh/calendar";
import type { InboundClassification } from "@keeper.sh/calendar";
import { countsTowardDeleteCap, isUnresolvedAttempt } from "../src/write-back";
import { runWriteBackPass } from "../src/write-back-pass";
import type {
  LockedWriteBackStore,
  SourceEventSnapshot,
  WriteBackStore,
  WriteBackTarget,
} from "../src/write-back-pass";

const SOURCE_CALENDAR_ID = "source-calendar-id";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const CALENDAR_URL = "https://caldav.example.com/calendars/personal";
const PUSHED_HASH = "the-hash-of-what-we-last-pushed";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");

const SOURCE_EVENT: SourceEventSnapshot = {
  description: null,
  endTime: END_TIME,
  isAllDay: null,
  location: null,
  startTime: START_TIME,
  startTimeZone: null,
  title: "Quarterly review",
};

const createTarget = (index: number): WriteBackTarget => ({
  deleteIdentifier: `mirror-${index}`,
  destinationCalendarId: DESTINATION_CALENDAR_ID,
  destinationEventUid: `mirror-${index}`,
  eventStateId: `event-state-${index}`,
  mappingId: `mapping-${index}`,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  sourceEventId: null,
  sourceEventUid: `source-event-uid-${index}`,
});

const createDelete = (index: number): InboundClassification => ({
  expectedSource: {
    description: "",
    endTime: END_TIME,
    isAllDay: false,
    location: "",
    startTime: START_TIME,
    summary: "Quarterly review",
  },
  expectedSyncEventHash: PUSHED_HASH,
  mappingId: `mapping-${index}`,
  sourceEventUid: `source-event-uid-${index}`,
  type: "delete",
});

/*
 * The whole failure is inside createDAVClient: tsdav runs service discovery, principal and
 * calendar-home requests before it hands a client back, so an unreachable server rejects the
 * thunk the writer opens with. Nothing on the calendar was touched.
 */
const createHarness = (options: { serverReachable: () => boolean }) => {
  const destroyedOnTheProvider: string[] = [];
  const tombstones = new Map<string, { appliedAt: Date | null; state: string }>();
  const quarantines: string[] = [];
  const epochs = new Map<string, number>();

  const writer = createCalDAVSourceWriter({
    calendarUrl: CALENDAR_URL,
    client: () => {
      if (!options.serverReachable()) {
        return Promise.reject(new TypeError("fetch failed"));
      }
      return Promise.resolve({
        deleteCalendarObject: (request: { calendarObject: { url: string } }) => {
          destroyedOnTheProvider.push(request.calendarObject.url);
          return Promise.resolve(new Response(null, { status: 204 }));
        },
        fetchCalendarObjects: (request: { objectUrls?: string[] }) => {
          const [url] = request.objectUrls ?? [];
          if (!url) {
            return Promise.resolve([]);
          }
          const uid = url.slice(CALENDAR_URL.length + 1, -".ics".length);
          return Promise.resolve([
            {
              data: [
                "BEGIN:VCALENDAR",
                "VERSION:2.0",
                "PRODID:-//Example//Example//EN",
                "BEGIN:VEVENT",
                `UID:${uid}`,
                "DTSTAMP:20270101T000000Z",
                "DTSTART:20270511T140000Z",
                "DTEND:20270511T150000Z",
                "SUMMARY:Quarterly review",
                "END:VEVENT",
                "END:VCALENDAR",
              ].join("\r\n"),
              url,
            },
          ]);
        },
        updateCalendarObject: () => Promise.resolve(new Response(null, { status: 204 })),
      });
    },
  });

  const locked: LockedWriteBackStore = {
    commitDelete: ({ tombstoneId }) => {
      tombstones.set(tombstoneId, { appliedAt: new Date(), state: "applied" });
      return Promise.resolve();
    },
    commitUpdate: () => Promise.resolve({ writeBackEpoch: 1 }),
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
    readPairWriteBack: () =>
      Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
    readSourceEvent: () => Promise.resolve(SOURCE_EVENT),
  };

  const store: WriteBackStore = {
    abandonTombstone: ({ tombstoneId }) => {
      tombstones.set(tombstoneId, { appliedAt: null, state: "abandoned" });
      return Promise.resolve();
    },
    countRecentDeletes: () =>
      Promise.resolve(
        [...tombstones.values()].filter((row) => countsTowardDeleteCap(row.state)).length,
      ),
    loadTarget: (mappingId) =>
      Promise.resolve(createTarget(Number(mappingId.replace("mapping-", "")))),
    notifySiblings: () => Promise.resolve(),
    probeDestinationEvent: () => Promise.resolve("absent"),
    quarantineMapping: (_source, _destination, reason) => {
      quarantines.push(reason);
      return Promise.resolve();
    },
    readSourceEvent: () => Promise.resolve(SOURCE_EVENT),
    recordFailure: (mappingId) => {
      const spent = (epochs.get(mappingId) ?? 0) + 1;
      epochs.set(mappingId, spent);
      return Promise.resolve(spent);
    },
    recordTombstone: ({ target }) => {
      const tombstoneId = `tombstone-${target.mappingId}`;
      const previous = tombstones.get(tombstoneId);
      const priorAttempt = isUnresolvedAttempt(previous);
      tombstones.set(tombstoneId, { appliedAt: null, state: "pending" });
      return Promise.resolve({ id: tombstoneId, observedAt: new Date(), priorAttempt });
    },
    requestDeleteConfirmation: () => Promise.resolve(),
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  return {
    countedTombstones: () =>
      [...tombstones.values()].filter((row) => countsTowardDeleteCap(row.state)),
    destroyedOnTheProvider,
    quarantines,
    store,
  };
};

const runDeletes = async (
  store: WriteBackStore,
  indices: number[],
): Promise<void> => {
  await runWriteBackPass({
    calendarId: DESTINATION_CALENDAR_ID,
    classifications: indices.map((index) => createDelete(index)),
    store,
  });
};

const range = (start: number, count: number): number[] =>
  Array.from({ length: count }, (_unused, offset) => start + offset);

describe("a CalDAV server that cannot be reached spends no source-deletion budget", () => {
  it("records no deletion for events it never asked about", async () => {
    const harness = createHarness({ serverReachable: () => false });

    await runDeletes(harness.store, range(0, 25));
    await runDeletes(harness.store, range(25, 25));

    expect(harness.destroyedOnTheProvider).toEqual([]);
    expect(harness.countedTombstones()).toEqual([]);
  });

  it("still allows the genuine deletion once the server is back", async () => {
    let reachable = false;
    const harness = createHarness({ serverReachable: () => reachable });

    await runDeletes(harness.store, range(0, 25));
    await runDeletes(harness.store, range(25, 25));
    reachable = true;
    await runDeletes(harness.store, [100]);

    expect(harness.quarantines).not.toContain("delete_daily_cap");
    expect(harness.destroyedOnTheProvider).toEqual([
      `${CALENDAR_URL}/source-event-uid-100.ics`,
    ]);
  });
});
