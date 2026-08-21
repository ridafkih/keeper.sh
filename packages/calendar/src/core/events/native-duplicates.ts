import { eventStatesTable } from "@keeper.sh/database/schema";
import { MS_PER_DAY } from "@keeper.sh/constants";
import { and, eq, gte, isNotNull, or } from "drizzle-orm";
import type { BunSQLClient } from "../database-client";
import type { MaterializedSyncableEvent, SyncableEvent } from "../types";
import type { SyncWindow } from "../sync/sync-range";
import { isKeeperEvent } from "./identity";
import {
  getRecurrenceWindowLookbackMilliseconds,
  materializeRecurrenceEvents,
} from "./recurrence-materializer";
import { parseStoredRecurrenceForMaterialization } from "./stored-recurrence";
import type { MaterializedRecurrenceFields } from "./stored-recurrence";

interface NativeEventStateRow {
  endTime: Date;
  exceptionDates: string | null;
  id: string;
  isAllDay: boolean | null;
  recurrenceId: Date | null;
  recurrenceRule: string | null;
  sourceEventUid: string | null;
  startTime: Date;
  startTimeZone: string | null;
}

interface NativeEventParseResult {
  events: SyncableEvent[];
  unparseableSeriesUids: Set<string>;
}

interface NativeOccurrenceIndex {
  occurrenceKeys: ReadonlySet<string>;
  withheldSeriesUids: ReadonlySet<string>;
}

interface PlaceableSeriesExpansion {
  placeableStart: number;
  slots: Set<number>;
}

interface DisplaceableSlotRange {
  end: number;
  start: number;
}

interface NativeDuplicateFilterResult {
  events: MaterializedSyncableEvent[];
  suppressedCount: number;
}

const DUPLICATE_MASTER_THRESHOLD = 1;

/*
 * Second granularity, matching the slot keys reconciliation already compares on: the two
 * copies of one invitation travel through different providers, which round sub-second
 * precision differently. Rules are never compared — providers rewrite them in transit — so
 * only the instants each side expands decide whether a copy is the same occurrence.
 */
const getNativeOccurrenceKey = (
  event: Pick<SyncableEvent, "endTime" | "sourceEventUid" | "startTime">,
): string => JSON.stringify([
  event.sourceEventUid,
  Math.trunc(event.startTime.getTime() / 1000),
  Math.trunc(event.endTime.getTime() / 1000),
]);

/*
 * A deliberately thin read: the destination's own outbound-sync exclusions (all-day,
 * focus time, out of office, privacy templating) say what it declines to publish, not what
 * occupies it. A native copy the destination never publishes still has to suppress its
 * duplicate, so this reads event_states alone.
 */
const readNativeEventStates = (
  database: BunSQLClient,
  calendarId: string,
  window: SyncWindow,
): Promise<NativeEventStateRow[]> => database
  .select({
    endTime: eventStatesTable.endTime,
    exceptionDates: eventStatesTable.exceptionDates,
    id: eventStatesTable.id,
    isAllDay: eventStatesTable.isAllDay,
    recurrenceId: eventStatesTable.recurrenceId,
    recurrenceRule: eventStatesTable.recurrenceRule,
    sourceEventUid: eventStatesTable.sourceEventUid,
    startTime: eventStatesTable.startTime,
    startTimeZone: eventStatesTable.startTimeZone,
  })
  .from(eventStatesTable)
  .where(
    and(
      eq(eventStatesTable.calendarId, calendarId),
      // Deliberately a superset of the real lower bound; the expansion decides the rest.
      or(
        gte(eventStatesTable.endTime, window.timeMin),
        gte(eventStatesTable.startTime, window.timeMin),
        isNotNull(eventStatesTable.recurrenceRule),
        isNotNull(eventStatesTable.recurrenceId),
      ),
    ),
  );

/*
 * Stored recurrence that no longer parses is an expected live state — the ingest path
 * carries its own recovery for it (parseStoredSourceEventStatesRecoveringInvalid). This
 * read is on the push path, where a rejection is not backoff-eligible and would abort
 * every remaining destination of the user, so a bad row costs its series and nothing more.
 */
const parseNativeRecurrence = (
  row: NativeEventStateRow,
): MaterializedRecurrenceFields | null => {
  try {
    return parseStoredRecurrenceForMaterialization({
      eventId: row.id,
      exceptionDates: row.exceptionDates,
      recurrenceId: row.recurrenceId,
      recurrenceRule: row.recurrenceRule,
    });
  } catch {
    return null;
  }
};

/*
 * An unparseable row costs its whole UID, not just itself: an override that failed to
 * parse is an override the expansion cannot place, leaving the master indexed at a slot
 * the destination has actually moved.
 */
const toNativeEvents = (
  rows: NativeEventStateRow[],
  calendarId: string,
): NativeEventParseResult => {
  const events: SyncableEvent[] = [];
  const unparseableSeriesUids = new Set<string>();

  for (const row of rows) {
    /*
     * Ingestion already skips Keeper mirrors, but a legacy row must never count as a
     * native copy: the mirror would then suppress the very source event it was written
     * from, and the next run would retire it.
     */
    if (!row.sourceEventUid || isKeeperEvent(row.sourceEventUid)) {
      continue;
    }

    const recurrence = parseNativeRecurrence(row);
    if (!recurrence) {
      unparseableSeriesUids.add(row.sourceEventUid);
      continue;
    }

    events.push({
      calendarId,
      calendarName: null,
      calendarUrl: null,
      endTime: row.endTime,
      eventStateId: row.id,
      id: row.id,
      ...(row.isAllDay !== null && { isAllDay: row.isAllDay }),
      ...recurrence,
      sourceEventUid: row.sourceEventUid,
      startTime: row.startTime,
      ...(row.startTimeZone !== null && { startTimeZone: row.startTimeZone }),
      summary: "",
    });
  }

  return { events, unparseableSeriesUids };
};

/*
 * Two master rows for one UID leave the expansion unable to attribute that series'
 * overrides, so a slot the destination has actually moved would still be indexed at its
 * original instant and wrongly suppress the source's copy of it. Withhold the series
 * instead: an unsuppressed duplicate is the clutter this feature removes, while a
 * suppressed non-duplicate is a missing event.
 */
const getDuplicateMasterSeriesUids = (events: SyncableEvent[]): Set<string> => {
  const masterCountsByUid = new Map<string, number>();

  for (const event of events) {
    if (!event.recurrenceRule || event.recurrenceId) {
      continue;
    }
    const uid = event.sourceEventUid;
    masterCountsByUid.set(uid, (masterCountsByUid.get(uid) ?? 0) + 1);
  }

  const duplicateSeriesUids = new Set<string>();
  for (const [uid, masterCount] of masterCountsByUid) {
    if (masterCount > DUPLICATE_MASTER_THRESHOLD) {
      duplicateSeriesUids.add(uid);
    }
  }

  return duplicateSeriesUids;
};

/*
 * The stretch in which a reference can still be the twin of an indexed slot, opened by one
 * occurrence interval past the first and last slot the rule produces: a reference further out
 * than that names a position the rule reaches at no point in this window — a declined date
 * left behind when COUNT or UNTIL shortened the series, or one anchored before it opens — so
 * every slot it could have vacated is somewhere else entirely. A day floors the interval, the
 * widest a provider re-anchoring the reference into another zone can carry it off its slot.
 */
const getDisplaceableSlotRange = (slots: Set<number>): DisplaceableSlotRange | null => {
  if (slots.size === 0) {
    return null;
  }
  const orderedSlots = [...slots].toSorted((first, second) => first - second);
  const [firstSlot = 0] = orderedSlots;
  let lastSlot = firstSlot;
  let widestInterval = MS_PER_DAY;
  for (const slot of orderedSlots) {
    widestInterval = Math.max(widestInterval, slot - lastSlot);
    lastSlot = slot;
  }

  return { end: lastSlot + widestInterval, start: firstSlot - widestInterval };
};

/*
 * Both RECURRENCE-ID and EXDATE name a slot by an exact-millisecond match against the
 * expansion, so a provider that rounds one or anchors it in another zone leaves the slot it
 * meant to displace standing: the override's original slot survives beside it at its moved
 * time, and the declined slot is never excluded at all. Either way the index claims an
 * instant the destination has vacated — and a declined slot is the worse half, since
 * suppressing it hides the one occurrence the mirror was needed for. Expanding the masters
 * alone names the slots such a reference can still land on. One that names none of them costs
 * its series, exactly as a duplicate master does; one outside the stretch those slots occupy
 * displaces nothing that gets indexed, so it withholds nothing. The floor under that stretch
 * is the expansion's own lookback, not the window's start: the index expands from a series
 * duration before timeMin so an occurrence already running there is reached, and a reference
 * landing anywhere in that lookback can still be the mis-anchored twin of an indexed slot.
 */
const getUnplaceableSlotSeriesUids = (
  events: SyncableEvent[],
  window: SyncWindow,
): Set<string> => {
  const claimedSlotsByUid = new Map<string, number[]>();
  const masters: SyncableEvent[] = [];

  const addClaimedSlot = (uid: string, slot: number): void => {
    const slots = claimedSlotsByUid.get(uid) ?? [];
    slots.push(slot);
    claimedSlotsByUid.set(uid, slots);
  };

  for (const event of events) {
    if (event.recurrenceId) {
      addClaimedSlot(event.sourceEventUid, event.recurrenceId.getTime());
      continue;
    }
    if (event.recurrenceRule) {
      masters.push(event);
      for (const exceptionDate of event.exceptionDates ?? []) {
        addClaimedSlot(event.sourceEventUid, exceptionDate.getTime());
      }
    }
  }

  const unplaceableSeriesUids = new Set<string>();
  const claimedMasters = masters.filter(
    (master) => claimedSlotsByUid.has(master.sourceEventUid),
  );
  if (claimedMasters.length === 0) {
    return unplaceableSeriesUids;
  }

  /*
   * Grouped so every master is expanded from its own floor: a longer series on the same
   * calendar reaches further back for its own occurrences, but it adds no stretch in which a
   * shorter one has an indexed slot to be displaced from. Judged against that borrowed floor,
   * a reference below everything its series indexes would cost a series that is entirely
   * placeable — one row's damage spreading to a neighbour it never touched.
   */
  const mastersByLookback = new Map<number, SyncableEvent[]>();
  for (const master of claimedMasters) {
    const lookback = getRecurrenceWindowLookbackMilliseconds(master);
    const lookbackMasters = mastersByLookback.get(lookback) ?? [];
    lookbackMasters.push(master);
    mastersByLookback.set(lookback, lookbackMasters);
  }

  const expansionsByUid = new Map<string, PlaceableSeriesExpansion>();
  for (const [lookback, lookbackMasters] of mastersByLookback) {
    const placeableStart = window.timeMin.getTime() - lookback;
    /*
     * Expanded without their own exception dates: an EXDATE that does land on a slot must
     * still leave that slot visible here, or every correctly anchored one would look
     * unplaceable.
     */
    const masterOccurrences = materializeRecurrenceEvents(
      lookbackMasters.map(({ exceptionDates: _exceptionDates, ...master }) => master),
      {
        end: window.timeMax,
        start: new Date(placeableStart),
      },
      {
        onSeriesOverBudget: (error) => {
          unplaceableSeriesUids.add(error.sourceEventUid);
        },
      },
    );
    for (const master of lookbackMasters) {
      const expansion = expansionsByUid.get(master.sourceEventUid);
      if (!expansion) {
        expansionsByUid.set(master.sourceEventUid, {
          placeableStart,
          slots: new Set<number>(),
        });
        continue;
      }
      expansion.placeableStart = Math.min(expansion.placeableStart, placeableStart);
    }
    for (const occurrence of masterOccurrences) {
      expansionsByUid.get(occurrence.sourceEventUid)?.slots.add(
        occurrence.startTime.getTime(),
      );
    }
  }

  for (const [uid, claimedSlots] of claimedSlotsByUid) {
    const expansion = expansionsByUid.get(uid);
    if (!expansion) {
      continue;
    }
    /*
     * A series the rule produces nothing for over this window has no indexed slot to be
     * vacated, so its references answer for nothing and cost it nothing.
     */
    const displaceable = getDisplaceableSlotRange(expansion.slots);
    if (!displaceable) {
      continue;
    }
    const isUnplaceable = claimedSlots.some((slot) => slot >= expansion.placeableStart
      && slot >= displaceable.start
      && slot <= displaceable.end
      && slot < window.timeMax.getTime()
      && !expansion.slots.has(slot));
    if (isUnplaceable) {
      unplaceableSeriesUids.add(uid);
    }
  }

  return unplaceableSeriesUids;
};

const getNativeOccurrenceIndex = async (
  database: BunSQLClient,
  calendarId: string,
  window: SyncWindow,
): Promise<NativeOccurrenceIndex> => {
  const rows = await readNativeEventStates(database, calendarId, window);
  const { events: nativeEvents, unparseableSeriesUids } = toNativeEvents(rows, calendarId);
  const withheldSeriesUids = getDuplicateMasterSeriesUids(nativeEvents);
  for (const uid of unparseableSeriesUids) {
    withheldSeriesUids.add(uid);
  }
  for (const uid of getUnplaceableSlotSeriesUids(nativeEvents, window)) {
    withheldSeriesUids.add(uid);
  }
  const indexableEvents = nativeEvents.filter(
    (event) => !withheldSeriesUids.has(event.sourceEventUid),
  );
  const occurrenceKeys = new Set<string>();

  if (indexableEvents.length > 0) {
    const occurrences = materializeRecurrenceEvents(indexableEvents, {
      end: window.timeMax,
      start: window.timeMin,
    }, {
      onSeriesOverBudget: (error) => {
        withheldSeriesUids.add(error.sourceEventUid);
      },
    });

    for (const occurrence of occurrences) {
      occurrenceKeys.add(getNativeOccurrenceKey(occurrence));
    }
  }

  return { occurrenceKeys, withheldSeriesUids };
};

const filterNativeDuplicateOccurrences = (
  events: MaterializedSyncableEvent[],
  index: NativeOccurrenceIndex,
): NativeDuplicateFilterResult => {
  const retained: MaterializedSyncableEvent[] = [];
  let suppressedCount = 0;

  for (const event of events) {
    if (index.occurrenceKeys.has(getNativeOccurrenceKey(event))) {
      suppressedCount += 1;
      continue;
    }
    retained.push(event);
  }

  return { events: retained, suppressedCount };
};

export { filterNativeDuplicateOccurrences, getNativeOccurrenceIndex };
export type { NativeDuplicateFilterResult, NativeOccurrenceIndex };
