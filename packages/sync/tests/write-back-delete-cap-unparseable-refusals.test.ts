import { afterEach, describe, expect, it, vi } from "vitest";
import { TWO_WAY_DELETE_DAILY_CAP } from "@keeper.sh/constants";
import { createGoogleSourceWriter } from "@keeper.sh/calendar";
import type { CalendarSourceWriter, InboundClassification } from "@keeper.sh/calendar";
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
const PUSHED_HASH = "the-hash-of-what-we-last-pushed";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const PER_PASS = 25;
const NONE = 0;
const ONE = 1;

const SOURCE_EVENT: SourceEventSnapshot = {
  description: null,
  endTime: END_TIME,
  isAllDay: null,
  location: null,
  startTime: START_TIME,
  startTimeZone: null,
  title: null,
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
    summary: "Busy",
  },
  expectedSyncEventHash: PUSHED_HASH,
  mappingId: `mapping-${index}`,
  sourceEventUid: `source-event-uid-${index}`,
  type: "delete",
});

const OK = 200;
const SERVICE_UNAVAILABLE = 503;
const NO_CONTENT = 204;
const GATEWAY_HTML = "<html><head><title>503 Service Unavailable</title></head></html>";

/*
 * The pass drives the real Google source writer, because the fact under test is what a
 * refusal the provider phrased in HTML costs the user: a refusal the writer cannot answer
 * leaves the record of the deletion standing, and enough of those spend the day's whole
 * source-deletion budget on deletions that never happened.
 */
const createHarness = () => {
  const destroyedOnTheProvider: string[] = [];
  const tombstones = new Map<string, { state: string }>();
  const quarantines: string[] = [];
  const epochs = new Map<string, number>();
  const state = { refusing: true };

  globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = String(input);
    if (method === "GET") {
      const [, sourceEventUid] = /iCalUID=([^&]+)/.exec(url) ?? [];
      return Promise.resolve(
        Response.json(
          {
            items: [{
              iCalUID: decodeURIComponent(sourceEventUid ?? ""),
              id: decodeURIComponent(sourceEventUid ?? ""),
            }],
          },
          { status: OK },
        ),
      );
    }
    if (state.refusing) {
      return Promise.resolve(
        new Response(GATEWAY_HTML, {
          headers: { "content-type": "text/html" },
          status: SERVICE_UNAVAILABLE,
        }),
      );
    }
    destroyedOnTheProvider.push(decodeURIComponent(url.split("/").pop() ?? ""));
    return Promise.resolve(new Response(null, { status: NO_CONTENT }));
  }) as unknown as typeof fetch;

  const writer: CalendarSourceWriter = createGoogleSourceWriter({
    accessToken: () => Promise.resolve("token"),
    externalCalendarId: "primary",
  });

  const locked: LockedWriteBackStore = {
    commitDelete: ({ tombstoneId }) => {
      tombstones.set(tombstoneId, { state: "applied" });
      return Promise.resolve();
    },
    commitUpdate: () => Promise.resolve({ writeBackEpoch: ONE }),
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
    readPairWriteBack: () =>
      Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
    readSourceEvent: () => Promise.resolve(SOURCE_EVENT),
  };

  const store: WriteBackStore = {
    abandonTombstone: ({ tombstoneId }) => {
      tombstones.set(tombstoneId, { state: "abandoned" });
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
      const spent = (epochs.get(mappingId) ?? NONE) + ONE;
      epochs.set(mappingId, spent);
      return Promise.resolve(spent);
    },
    recordTombstone: ({ target }) => {
      const tombstoneId = `tombstone-${target.mappingId}`;
      const previous = tombstones.get(tombstoneId);
      const priorAttempt = isUnresolvedAttempt(previous);
      tombstones.set(tombstoneId, { state: "pending" });
      return Promise.resolve({ id: tombstoneId, observedAt: new Date(), priorAttempt });
    },
    requestDeleteConfirmation: () => Promise.resolve(),
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  return { destroyedOnTheProvider, quarantines, state, store, tombstones };
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const runPass = (
  store: WriteBackStore,
  indices: number[],
  reported: unknown[],
): Promise<unknown> =>
  runWriteBackPass({
    calendarId: DESTINATION_CALENDAR_ID,
    classifications: indices.map((index) => createDelete(index)),
    onError: (error) => {
      reported.push(error);
    },
    store,
  });

describe("a source provider that refuses a delete with an unparseable error body", () => {
  it("does not spend the day's source-deletion budget on deletions that never happened", async () => {
    const harness = createHarness();
    const reported: unknown[] = [];
    const rejected = Array.from({ length: TWO_WAY_DELETE_DAILY_CAP }, (_unused, index) => index);

    for (let offset = NONE; offset < rejected.length; offset += PER_PASS) {
      await runPass(harness.store, rejected.slice(offset, offset + PER_PASS), reported);
    }

    expect(reported).toHaveLength(TWO_WAY_DELETE_DAILY_CAP);
    expect(harness.destroyedOnTheProvider).toEqual([]);
    expect(harness.quarantines).not.toContain("delete_daily_cap");

    harness.state.refusing = false;
    await runPass(harness.store, [TWO_WAY_DELETE_DAILY_CAP], reported);

    expect(harness.quarantines).not.toContain("delete_daily_cap");
    expect(harness.destroyedOnTheProvider).toEqual([
      `source-event-uid-${TWO_WAY_DELETE_DAILY_CAP}`,
    ]);
  });
});
