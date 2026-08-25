import { DomHandler, DomUtils, Parser } from "htmlparser2";
import { decodeHTML } from "entities";
import type { EventMapping } from "../events/mappings";
import type {
  EventAvailability,
  MaterializedSyncableEvent,
  RemoteEvent,
  SyncOperation,
} from "../types";
import {
  createEditableEventContentHash,
  createEditableEventContentSnapshot,
  createSyncEventContentHash,
} from "../events/content-hash";
import { overlapsTimeWindow } from "../events/time-range";
import type { SyncWindow } from "./sync-range";

/*
 * Whether the destination can be asked what it actually stored — by echoing the stored form on
 * the write, or by an immediate read-back. Only then does a coercing server
 * record its own rewrite as the baseline at write time, which is what makes a later unexplained
 * value somebody else's edit. A destination we can never read back cannot tell its own coercion
 * from a third party's edit, and repairing on that guess puts a whole calendar into churn.
 */
interface ReconciliationScope {
  authoritativeMappingIds?: ReadonlySet<string>;
  authoritativeWindow: SyncWindow | null;
  authoritativeSourceWindows?: ReadonlyMap<string, SyncWindow>;
  configuredSourceCalendarIds?: ReadonlySet<string>;
  requestedWindow: SyncWindow;
  /*
   * Mappings the destination read could not settle either way - an exhausted verification
   * budget, or an answer that said so. Their absence from remoteEvents is not evidence.
   */
  unverifiedMappingIds?: ReadonlySet<string>;
  storedFormIsObservable?: boolean;
  withheldSourceEventStateIds?: ReadonlySet<string>;
}

interface StaleMappingResult {
  remoteMissingMappingIds: ReadonlySet<string>;
  staleReasonCounts: StaleReasonCounts;
  staleMappingIds: string[];
  staleMappedEventIds: Set<string>;
  staleRemoteMappings: EventMapping[];
}

interface ComputeSyncOperationsResult {
  mappingUpdates: MappingUpdate[];
  operations: SyncOperation[];
  staleReasonCounts: StaleReasonCounts;
  staleMappingIds: string[];
}

interface StaleReasonCounts {
  localHashChanged: number;
  occurrenceReassigned: number;
  remoteAvailabilityChanged: number;
  remoteContentChanged: number;
  remoteContentAllDayChanged: number;
  remoteContentDescriptionChanged: number;
  remoteContentDescriptionLocalLengthTotal: number;
  remoteContentDescriptionRemoteLengthTotal: number;
  remoteContentLocationChanged: number;
  remoteContentLocationLocalLengthTotal: number;
  remoteContentLocationRemoteLengthTotal: number;
  remoteContentSummaryChanged: number;
  remoteContentSummaryLocalLengthTotal: number;
  remoteContentSummaryRemoteLengthTotal: number;
  remoteMissing: number;
  remoteTimeChanged: number;
}

interface RemoteContentValueLengths {
  local: number;
  remote: number;
}

interface RemoteContentFieldChanges {
  allDay: boolean;
  description: boolean;
  lengths: Partial<Record<"description" | "location" | "summary", RemoteContentValueLengths>>;
  location: boolean;
  summary: boolean;
}

interface RemoteStateChanges {
  availability: boolean;
  content: boolean;
  contentFields: RemoteContentFieldChanges | null;
  time: boolean;
}

interface MappingUpdate {
  deleteIdentifier: string;
  endTime: Date;
  id: string;
  remoteAvailability: EventAvailability | null;
  remoteContentHash?: string;
  remoteContentHashRepairedFrom?: string | null;
  remoteEndTime: Date | null;
  remoteStartTime: Date | null;
  startTime: Date;
  syncEventHash: string;
  syncEventId: string;
}

interface OccurrenceReassignment {
  event: MaterializedSyncableEvent;
  mapping: EventMapping;
}

const createStaleReasonCounts = (): StaleReasonCounts => ({
  localHashChanged: 0,
  occurrenceReassigned: 0,
  remoteAvailabilityChanged: 0,
  remoteContentChanged: 0,
  remoteContentAllDayChanged: 0,
  remoteContentDescriptionChanged: 0,
  remoteContentDescriptionLocalLengthTotal: 0,
  remoteContentDescriptionRemoteLengthTotal: 0,
  remoteContentLocationChanged: 0,
  remoteContentLocationLocalLengthTotal: 0,
  remoteContentLocationRemoteLengthTotal: 0,
  remoteContentSummaryChanged: 0,
  remoteContentSummaryLocalLengthTotal: 0,
  remoteContentSummaryRemoteLengthTotal: 0,
  remoteMissing: 0,
  remoteTimeChanged: 0,
});

const getMappingSyncEventId = (mapping: EventMapping): string => mapping.syncEventId;

const getSourceAuthoritativeWindow = (
  scope: ReconciliationScope,
  sourceCalendarId: string | null,
): SyncWindow | null => {
  if (sourceCalendarId === null) {
    return scope.requestedWindow;
  }
  if (!scope.authoritativeSourceWindows || !scope.configuredSourceCalendarIds) {
    return scope.authoritativeWindow;
  }
  if (!scope.configuredSourceCalendarIds.has(sourceCalendarId)) {
    return scope.requestedWindow;
  }
  return scope.authoritativeSourceWindows.get(sourceCalendarId) ?? null;
};

const isInsideSourceAuthoritativeWindow = (
  value: Pick<EventMapping, "startTime" | "endTime">,
  sourceCalendarId: string | null,
  scope: ReconciliationScope,
): boolean => {
  const sourceWindow = getSourceAuthoritativeWindow(scope, sourceCalendarId);
  return sourceWindow !== null && overlapsTimeWindow(
    value,
    sourceWindow.timeMin,
    sourceWindow.timeMax,
  );
};

const compareMappingSlots = (first: EventMapping, second: EventMapping): number =>
  first.startTime.getTime() - second.startTime.getTime()
  || first.endTime.getTime() - second.endTime.getTime()
  || first.id.localeCompare(second.id);

const compareEventSlots = (
  first: MaterializedSyncableEvent,
  second: MaterializedSyncableEvent,
): number => first.startTime.getTime() - second.startTime.getTime()
  || first.endTime.getTime() - second.endTime.getTime()
  || first.id.localeCompare(second.id);

const getSerializedSlotKey = (startTime: Date, endTime: Date): string =>
  `${Math.trunc(startTime.getTime() / 1000)}\u0000${Math.trunc(endTime.getTime() / 1000)}`;

const pairReidentifiedMaterializedOccurrences = (
  localEvents: MaterializedSyncableEvent[],
  reassignableMappings: EventMapping[],
  allMappings: EventMapping[],
): OccurrenceReassignment[] => {
  const localEventIds = new Set(localEvents.map((event) => event.id));
  const mappedEventIds = new Set(allMappings.map((mapping) => getMappingSyncEventId(mapping)));
  const newEventsByOwner = new Map<string, MaterializedSyncableEvent[]>();
  const missingMappingsByOwner = new Map<string, EventMapping[]>();

  for (const event of localEvents) {
    if (!event.eventStateId || mappedEventIds.has(event.id)) {
      continue;
    }
    const events = newEventsByOwner.get(event.eventStateId) ?? [];
    events.push(event);
    newEventsByOwner.set(event.eventStateId, events);
  }

  for (const mapping of reassignableMappings) {
    if (localEventIds.has(getMappingSyncEventId(mapping))) {
      continue;
    }
    if (!mapping.eventStateId) {
      continue;
    }
    const mappings = missingMappingsByOwner.get(mapping.eventStateId) ?? [];
    mappings.push(mapping);
    missingMappingsByOwner.set(mapping.eventStateId, mappings);
  }

  const reassignments: OccurrenceReassignment[] = [];
  for (const [ownerId, events] of newEventsByOwner) {
    const mappings = missingMappingsByOwner.get(ownerId);
    if (!mappings) {
      continue;
    }
    const orderedEvents = events.toSorted(compareEventSlots);
    const orderedMappings = mappings.toSorted(compareMappingSlots);
    const mappingsBySlot = new Map<string, EventMapping[]>();
    for (const mapping of orderedMappings) {
      const slotKey = getSerializedSlotKey(mapping.startTime, mapping.endTime);
      const slotMappings = mappingsBySlot.get(slotKey) ?? [];
      slotMappings.push(mapping);
      mappingsBySlot.set(slotKey, slotMappings);
    }

    const pairedEventIds = new Set<string>();
    const pairedMappingIds = new Set<string>();
    for (const event of orderedEvents) {
      const slotMappings = mappingsBySlot.get(getSerializedSlotKey(
        event.startTime,
        event.endTime,
      ));
      const mapping = slotMappings?.shift();
      if (!mapping) {
        continue;
      }
      reassignments.push({ event, mapping });
      pairedEventIds.add(event.id);
      pairedMappingIds.add(mapping.id);
    }

    const remainingEvents = orderedEvents.filter((event) => !pairedEventIds.has(event.id));
    const remainingMappings = orderedMappings.filter(
      (mapping) => !pairedMappingIds.has(mapping.id),
    );
    const pairCount = Math.min(remainingEvents.length, remainingMappings.length);
    for (let index = 0; index < pairCount; index++) {
      const event = remainingEvents[index];
      const mapping = remainingMappings[index];
      if (event && mapping) {
        reassignments.push({ event, mapping });
      }
    }
  }

  return reassignments;
};

const isSameSerializedSecond = (first: Date, second: Date): boolean =>
  Math.trunc(first.getTime() / 1000) === Math.trunc(second.getTime() / 1000);

const getRemoteIdentity = (uid: string, deleteId: string): string =>
  `${uid}\u0000${deleteId}`;

const matchRemoteEventsToMappings = (
  mappings: EventMapping[],
  remoteEvents: RemoteEvent[],
): Map<string, RemoteEvent> => {
  const remoteEventsByIdentity = new Map(
    remoteEvents.map((event) => [getRemoteIdentity(event.uid, event.deleteId), event]),
  );
  const remoteEventsByUid = new Map<string, RemoteEvent[]>();
  for (const remoteEvent of remoteEvents) {
    const matchingUidEvents = remoteEventsByUid.get(remoteEvent.uid) ?? [];
    matchingUidEvents.push(remoteEvent);
    remoteEventsByUid.set(remoteEvent.uid, matchingUidEvents);
  }

  const matches = new Map<string, RemoteEvent>();
  for (const mapping of mappings) {
    const exactMatch = remoteEventsByIdentity.get(getRemoteIdentity(
      mapping.destinationEventUid,
      mapping.deleteIdentifier,
    ));
    if (exactMatch) {
      matches.set(mapping.id, exactMatch);
      continue;
    }

    if (mapping.deleteIdentifier !== mapping.destinationEventUid) {
      continue;
    }
    const legacyUidMatches = remoteEventsByUid.get(mapping.destinationEventUid) ?? [];
    if (legacyUidMatches.length === 1 && legacyUidMatches[0]) {
      matches.set(mapping.id, legacyUidMatches[0]);
    }
  }

  return matches;
};

const divergedContentLengths = (
  field: "description" | "location" | "summary",
  local: string,
  remote: string,
): RemoteContentFieldChanges["lengths"] => {
  if (local === remote) {
    return {};
  }
  return { [field]: { local: local.length, remote: remote.length } };
};

const observeRemoteContentHash = (remoteEvent: RemoteEvent): string | null => {
  if (typeof remoteEvent.editableContentHash !== "string") {
    return null;
  }
  return remoteEvent.editableContentHash;
};

/* Omitted rather than nulled: an absent baseline must not overwrite one already recorded. */
const recordedContentHashFields = (mapping: EventMapping): { recordedContentHash?: string } => {
  if (typeof mapping.remoteContentHash !== "string") {
    return {};
  }
  return { recordedContentHash: mapping.remoteContentHash };
};

const recordedContentHashUpdate = (recorded: string | null): { remoteContentHash?: string } => {
  if (recorded === null) {
    return {};
  }
  return { remoteContentHash: recorded };
};

const getRecordedRemoteContentHash = (mapping: EventMapping): string | null => {
  if (typeof mapping.remoteContentHash !== "string") {
    return null;
  }
  return mapping.remoteContentHash;
};

const getRepairedFromContentHash = (mapping: EventMapping): string | null =>
  mapping.remoteContentHashRepairedFrom ?? null;

/* The same text again, so the destination has no reason to store it in a different form. */
const isRewritingTheRecordedText = (
  mapping: EventMapping,
  localEvent: MaterializedSyncableEvent,
): boolean => mapping.syncEventHash === createSyncEventContentHash(localEvent);

/*
 * A destination may store a write in a form no capture of that write ever sees, so the recorded
 * baseline is a form no later read returns: the divergence repairs, the repair is captured in the
 * same unseen form, and the event is rewritten on every pass forever. The way out is proof rather
 * than trust. A repair rewrites our own text, so a read that comes back holding exactly the form
 * the repair wrote over has shown that form to be our text as this destination keeps it: an edit
 * does not survive our overwriting it. Only that reproduced form is adopted; anything else the
 * read returns is still somebody's edit, and is still repaired.
 */
const isReproducedByOurOwnRewrite = (
  mapping: EventMapping,
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
): boolean => {
  const repairedFrom = getRepairedFromContentHash(mapping);
  if (repairedFrom === null) {
    return false;
  }
  if (!isRewritingTheRecordedText(mapping, localEvent)) {
    return false;
  }
  return observeRemoteContentHash(remoteEvent) === repairedFrom;
};

/*
 * The shapes our own text takes at a destination that keeps it in its own way. It encodes it —
 * Google escapes the markup inside a description, Graph keeps a body as HTML, an iCalendar server
 * escapes the separators inside a TEXT value — or it cuts it at a length it always cuts at. Only
 * real markup is stripped, so an angle bracket we wrote stays text, and an edit that writes markup
 * of its own decodes to something other than what we wrote.
 */
const ICALENDAR_ESCAPES: Record<string, string> = {
  ",": ",",
  ";": ";",
  "N": "\n",
  "\\": "\\",
  "n": "\n",
};

const decodeICalendarText = (value: string): string =>
  value.replaceAll(/\\([\\,;nN])/g, (escape, character: string) =>
    ICALENDAR_ESCAPES[character] ?? escape);

/*
 * A regex cannot strip markup: one pass over `<scr<script>ipt>` leaves `<script>` behind, because
 * removing the inner tag rejoins the outer one. That is a correctness problem here before it is a
 * security one -- a mis-decode reads a stranger's edit as our own text and adopts it. A real
 * tokenizer sees the same bytes the destination's own parser did. Entities are left encoded here
 * so the decode below stays the single place that resolves them.
 */
const readMarkupText = (markup: string): string => {
  const handler = new DomHandler();
  new Parser(handler, { decodeEntities: false }).end(markup);

  return DomUtils.textContent(handler.dom);
};

const decodeDestinationStorageForm = (remote: string): string =>
  decodeICalendarText(decodeHTML(readMarkupText(remote)));

const isDestinationStorageEncoding = (local: string, remote: string): boolean =>
  decodeDestinationStorageForm(remote) === local;

/* Emptying a field is not a cut: nothing of ours survives it, so it is an editor's doing. */
const isDestinationTruncation = (local: string, remote: string): boolean =>
  remote.length > 0 && remote.length < local.length && local.startsWith(remote);

const isOurTextAsADestinationMayKeepIt = (local: string, remote: string): boolean => {
  if (local === remote) {
    return true;
  }
  if (isDestinationStorageEncoding(local, remote)) {
    return true;
  }
  return isDestinationTruncation(local, remote);
};

/*
 * Whether the form a read returned is one our own text could have taken at this destination at
 * all. A form that is nobody's storage of our text is somebody's edit, and recording an edit as
 * the form we repaired away from is what lets a third party win by applying the same edit twice:
 * the pass after the repair reads their repetition as our own rewrite echoed back, adopts it as
 * the baseline, and the event is never repaired again.
 */
const couldBeOurOwnTextAsStored = (
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
): boolean => {
  const remoteContent = remoteEvent.editableContent;
  /* A read carrying no fields is weighed against intent nowhere, and is not weighed here either. */
  if (!remoteContent) {
    return true;
  }
  const localContent = createEditableEventContentSnapshot(localEvent);
  if (remoteContent.isAllDay !== localContent.isAllDay) {
    return false;
  }
  return isOurTextAsADestinationMayKeepIt(localContent.summary, remoteContent.summary)
    && isOurTextAsADestinationMayKeepIt(localContent.description, remoteContent.description)
    && isOurTextAsADestinationMayKeepIt(localContent.location, remoteContent.location);
};

/*
 * Only a rewrite of the recorded text proves anything about the form that comes back, and only a
 * form our own text could have taken here is worth recording as the form it was repaired from.
 */
const repairedFromContentHashFields = (
  mapping: EventMapping,
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
): { repairedFromContentHash?: string } => {
  if (!isRewritingTheRecordedText(mapping, localEvent)) {
    return {};
  }
  if (!couldBeOurOwnTextAsStored(localEvent, remoteEvent)) {
    return {};
  }
  const observed = observeRemoteContentHash(remoteEvent);
  if (observed === null || observed === getRecordedRemoteContentHash(mapping)) {
    return {};
  }
  return { repairedFromContentHash: observed };
};

/*
 * Cleared as soon as a read confirms what the mapping records: an edit that later happens to
 * match the form we once repaired away from must be repaired too, not mistaken for our own
 * rewrite. A read that carries no form confirms nothing, so the proof is kept for the next one.
 */
const resolveRecordedRepairedFrom = (
  mapping: EventMapping,
  remoteEvent: RemoteEvent,
): string | null => {
  if (observeRemoteContentHash(remoteEvent) === null) {
    return getRepairedFromContentHash(mapping);
  }
  return null;
};

/* Written only when there is a proof to keep or a spent one to clear. */
const repairedFromUpdate = (
  mapping: EventMapping,
  recorded: string | null,
): { remoteContentHashRepairedFrom?: string | null } => {
  if (recorded === null && getRepairedFromContentHash(mapping) === null) {
    return {};
  }
  return { remoteContentHashRepairedFrom: recorded };
};

/*
 * A prefix relationship is no evidence of normalisation: the empty string is a prefix of every
 * text and shorter than all of them, so a third party who clears a field would be read as the
 * destination trimming it. A shortening is normalisation only where a documented bound explains
 * it: Google keeps 8192 characters of a description and that is the only such bound we know. A
 * field with no known bound gets no allowance at all, and its shortening is somebody's edit.
 */
const KNOWN_DESTINATION_LENGTH_LIMITS: Partial<
  Record<"description" | "location" | "summary", number>
> = {
  description: 8192,
};

const isDestinationLengthLimit = (
  field: "description" | "location" | "summary",
  local: string,
  remote: string,
): boolean => {
  const limit = KNOWN_DESTINATION_LENGTH_LIMITS[field];
  if (limit === globalThis.undefined) {
    return false;
  }
  /* Nothing was over the bound, so the bound cannot be what cut it. */
  if (local.length <= limit || remote.length > limit) {
    return false;
  }
  /* A bound clips what overruns it; it never empties a field, so an emptied one is a clearance. */
  if (remote.length === 0) {
    return false;
  }
  return local.startsWith(remote);
};

const isFieldExplainedByDestination = (
  field: "description" | "location" | "summary",
  local: string,
  remote: string,
): boolean => {
  if (local === remote) {
    return true;
  }
  return isDestinationLengthLimit(field, local, remote);
};

/*
 * Migration 0093 added remoteContentHash without a backfill, so every pre-existing mapping
 * arrives with no baseline. Local intent is the only truth available on that first pass, and
 * a remote the destination's own storage cannot account for must be repaired, not adopted.
 * Local events reach reconciliation already run through the provider's own normalisation,
 * so a faithful mirror compares equal here.
 */
const hasRemoteContentDivergedFromLocal = (
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
): boolean => {
  const remoteContent = remoteEvent.editableContent;
  /* Without the observed fields there is nothing to weigh intent against, and repairing on the
   * hash alone would recreate the event on every pass a destination normalises what we wrote. */
  if (!remoteContent) {
    return false;
  }
  const localContent = createEditableEventContentSnapshot(localEvent);
  if (remoteContent.isAllDay !== localContent.isAllDay) {
    return true;
  }
  return !isFieldExplainedByDestination("summary", localContent.summary, remoteContent.summary)
    || !isFieldExplainedByDestination(
      "description",
      localContent.description,
      remoteContent.description,
    )
    || !isFieldExplainedByDestination("location", localContent.location, remoteContent.location);
};

/*
 * A reassignment may settle in the database alone only when the destination already holds the
 * occurrence's current content. Re-anchoring a series reseeds occurrence ids while the instants
 * stay put, so the pairing survives a rename that the remote copy has never seen; without this
 * term the old title would stand on the destination forever, unwritten and unreported.
 */
const remoteHoldsOccurrenceContent = (
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
): boolean => {
  const observed = observeRemoteContentHash(remoteEvent);
  if (observed === null) {
    return false;
  }
  if (observed === createEditableEventContentHash(localEvent)) {
    return true;
  }
  /* Without the observed fields a differing hash is the only evidence there is, and it says no. */
  if (!remoteEvent.editableContent) {
    return false;
  }
  return !hasRemoteContentDivergedFromLocal(localEvent, remoteEvent);
};

/*
 * A destination may finish storing a write only after the capture has read it back, so the
 * recorded baseline is a form no later read returns and the divergence repairs, is captured
 * unsettled again, and repairs again on every pass forever. A rewrite puts back the same text,
 * and a form our own text still explains is that text as this destination keeps it, so the
 * repaired mapping records what the destination was seen holding rather than what the write
 * echoed back. A form our text cannot explain is somebody's edit and is not recorded at all.
 */
const settledContentHashFields = (
  mapping: EventMapping,
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
): { settledContentHash?: string } => {
  const observed = observeRemoteContentHash(remoteEvent);
  if (observed === null || observed === getRecordedRemoteContentHash(mapping)) {
    return {};
  }
  /* Without the observed fields nothing can explain the form, and an unexplained one is an edit. */
  if (!remoteEvent.editableContent) {
    return {};
  }
  if (hasRemoteContentDivergedFromLocal(localEvent, remoteEvent)) {
    return {};
  }
  return { settledContentHash: observed };
};

const hasRemoteContentDiverged = (
  mapping: EventMapping,
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
): boolean => {
  const observed = observeRemoteContentHash(remoteEvent);
  if (observed === null) {
    return false;
  }
  if (isReproducedByOurOwnRewrite(mapping, localEvent, remoteEvent)) {
    return false;
  }
  const recorded = getRecordedRemoteContentHash(mapping);
  if (recorded === null) {
    return hasRemoteContentDivergedFromLocal(localEvent, remoteEvent);
  }
  return observed !== recorded;
};

/* Only a remote that still matches what we intend may become the baseline we later compare to. */
const resolveRecordedRemoteContentHash = (
  mapping: EventMapping,
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
): string | null => {
  /* The proved form is what the destination holds; the recorded one is what it never returned. */
  if (isReproducedByOurOwnRewrite(mapping, localEvent, remoteEvent)) {
    return observeRemoteContentHash(remoteEvent);
  }
  const recorded = getRecordedRemoteContentHash(mapping);
  if (recorded !== null) {
    return recorded;
  }
  if (hasRemoteContentDiverged(mapping, localEvent, remoteEvent)) {
    return null;
  }
  return observeRemoteContentHash(remoteEvent);
};

/*
 * A destination that keeps a coarser precision than we sent stores the instant we asked for,
 * rounded inside its own minute; a third party who moved the event leaves it somewhere else.
 * The mapping's own times are what we last wrote, so they are what the stored form has to be
 * explained by. Only a mapping with no recorded form is weighed this way; once one exists the
 * comparison is against what the destination was seen holding.
 */
const NORMALISATION_TOLERANCE_MS = 60_000;

const isExplainedByDestinationRounding = (written: Date, stored: Date): boolean =>
  Math.abs(stored.getTime() - written.getTime()) < NORMALISATION_TOLERANCE_MS;

const hasRemoteTimeDivergedFromWritten = (
  mapping: EventMapping,
  remoteEvent: RemoteEvent,
): boolean => !isExplainedByDestinationRounding(mapping.startTime, remoteEvent.startTime)
  || !isExplainedByDestinationRounding(mapping.endTime, remoteEvent.endTime);

interface RecordedRemoteTimes {
  remoteEndTime: Date | null;
  remoteStartTime: Date | null;
}

/* Both instants or neither: half a baseline says nothing about the span the destination holds. */
const getRecordedRemoteTimes = (mapping: EventMapping): RecordedRemoteTimes => {
  const { remoteEndTime, remoteStartTime } = mapping;
  if (!remoteStartTime || !remoteEndTime) {
    return { remoteEndTime: null, remoteStartTime: null };
  }
  return { remoteEndTime, remoteStartTime };
};

const getRecordedRemoteAvailability = (mapping: EventMapping): EventAvailability | null =>
  mapping.remoteAvailability ?? null;

/*
 * The recorded times and availability travel with the operation for the same reason the form does:
 * a replacement whose capture comes back empty would otherwise record none, and the next pass
 * would compare the destination against local intent and churn.
 */
const recordedRemoteFormFields = (mapping: EventMapping): {
  recordedAvailability?: EventAvailability;
  recordedEndTime?: Date;
  recordedStartTime?: Date;
} => {
  const availability = getRecordedRemoteAvailability(mapping);
  const { remoteEndTime, remoteStartTime } = getRecordedRemoteTimes(mapping);
  return {
    ...(availability !== null && { recordedAvailability: availability }),
    ...(remoteEndTime !== null && remoteStartTime !== null && {
      recordedEndTime: remoteEndTime,
      recordedStartTime: remoteStartTime,
    }),
  };
};

const hasRemoteTimeDiverged = (
  mapping: EventMapping,
  remoteEvent: RemoteEvent,
): boolean => {
  const { remoteEndTime, remoteStartTime } = getRecordedRemoteTimes(mapping);
  if (remoteStartTime === null || remoteEndTime === null) {
    return hasRemoteTimeDivergedFromWritten(mapping, remoteEvent);
  }
  return !isSameSerializedSecond(remoteEvent.startTime, remoteStartTime)
    || !isSameSerializedSecond(remoteEvent.endTime, remoteEndTime);
};

/* What an event with no availability of its own asks the destination to store. */
const DEFAULT_INTENDED_AVAILABILITY: EventAvailability = "busy";

const getIntendedAvailability = (localEvent: MaterializedSyncableEvent): EventAvailability =>
  localEvent.availability ?? DEFAULT_INTENDED_AVAILABILITY;

/*
 * A server that rewrites the TRANSP it is handed reports the rewrite on the write itself, so its
 * coerced value is already the recorded baseline by the time any later pass compares against it.
 * A mapping with no baseline holds no such evidence — which is every mapping in the fleet on the
 * deploy that first reads the column — so what it is seen holding is weighed against what we
 * intend rather than adopted: adopting it makes a third party's flip to free silently permanent.
 * supportedAvailabilities is a static literal in every destination provider rather than an
 * observation, so it is no evidence of what a server will accept and is not consulted here.
 */
const hasRemoteAvailabilityDivergedFromLocal = (
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
): boolean => {
  const observed = remoteEvent.editableAvailability;
  if (typeof observed !== "string") {
    return false;
  }
  return observed !== getIntendedAvailability(localEvent);
};

const hasRemoteAvailabilityDiverged = (
  mapping: EventMapping,
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
  storedFormIsObservable: boolean,
): boolean => {
  const observed = remoteEvent.editableAvailability;
  if (typeof observed !== "string") {
    return false;
  }
  const recorded = getRecordedRemoteAvailability(mapping);
  if (recorded === null) {
    return storedFormIsObservable
      && hasRemoteAvailabilityDivergedFromLocal(localEvent, remoteEvent);
  }
  return observed !== recorded;
};

/* Only a remote whose availability still matches what we intend may become the baseline. */
const resolveRecordedRemoteAvailability = (
  mapping: EventMapping,
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
  storedFormIsObservable: boolean,
): EventAvailability | null => {
  const recorded = getRecordedRemoteAvailability(mapping);
  if (recorded !== null) {
    return recorded;
  }
  if (storedFormIsObservable && hasRemoteAvailabilityDivergedFromLocal(localEvent, remoteEvent)) {
    return null;
  }
  return remoteEvent.editableAvailability ?? null;
};

const isSameRecordedInstant = (first: Date | null, second: Date | null): boolean => {
  if (first === null || second === null) {
    return first === second;
  }
  return first.getTime() === second.getTime();
};

/* Only a remote whose times the destination's own rounding explains may become the baseline. */
const resolveRecordedRemoteTimes = (
  mapping: EventMapping,
  remoteEvent: RemoteEvent,
): RecordedRemoteTimes => {
  const recorded = getRecordedRemoteTimes(mapping);
  if (recorded.remoteStartTime !== null && recorded.remoteEndTime !== null) {
    return recorded;
  }
  if (hasRemoteTimeDivergedFromWritten(mapping, remoteEvent)) {
    return { remoteEndTime: null, remoteStartTime: null };
  }
  return { remoteEndTime: remoteEvent.endTime, remoteStartTime: remoteEvent.startTime };
};

const getRemoteStateChanges = (
  mapping: EventMapping,
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
  storedFormIsObservable: boolean,
): RemoteStateChanges => {
  const remoteContentChanged = hasRemoteContentDiverged(mapping, localEvent, remoteEvent);
  let contentFields: RemoteContentFieldChanges | null = null;
  if (remoteContentChanged && remoteEvent.editableContent) {
    const localContent = createEditableEventContentSnapshot(localEvent);
    const remoteContent = remoteEvent.editableContent;
    contentFields = {
      allDay: remoteContent.isAllDay !== localContent.isAllDay,
      description: remoteContent.description !== localContent.description,
      lengths: {
        ...divergedContentLengths("description", localContent.description, remoteContent.description),
        ...divergedContentLengths("location", localContent.location, remoteContent.location),
        ...divergedContentLengths("summary", localContent.summary, remoteContent.summary),
      },
      location: remoteContent.location !== localContent.location,
      summary: remoteContent.summary !== localContent.summary,
    };
  }
  const remoteAvailabilityChanged = hasRemoteAvailabilityDiverged(
    mapping,
    localEvent,
    remoteEvent,
    storedFormIsObservable,
  );
  const remoteTimeChanged = hasRemoteTimeDiverged(mapping, remoteEvent);

  return {
    availability: remoteAvailabilityChanged,
    content: remoteContentChanged,
    contentFields,
    time: remoteTimeChanged,
  };
};

const hasRemoteStateChanged = (
  mapping: EventMapping,
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
  storedFormIsObservable: boolean,
): boolean => {
  const changes = getRemoteStateChanges(mapping, localEvent, remoteEvent, storedFormIsObservable);
  return changes.availability || changes.content || changes.time;
};

const recordRemoteContentLengths = (
  staleReasonCounts: StaleReasonCounts,
  contentFields: RemoteContentFieldChanges | null,
): void => {
  const lengths = contentFields?.lengths ?? {};
  const empty = { local: 0, remote: 0 };
  const description = lengths.description ?? empty;
  const location = lengths.location ?? empty;
  const summary = lengths.summary ?? empty;

  staleReasonCounts.remoteContentDescriptionLocalLengthTotal += description.local;
  staleReasonCounts.remoteContentDescriptionRemoteLengthTotal += description.remote;
  staleReasonCounts.remoteContentLocationLocalLengthTotal += location.local;
  staleReasonCounts.remoteContentLocationRemoteLengthTotal += location.remote;
  staleReasonCounts.remoteContentSummaryLocalLengthTotal += summary.local;
  staleReasonCounts.remoteContentSummaryRemoteLengthTotal += summary.remote;
};

const recordStaleReasons = (
  staleReasonCounts: StaleReasonCounts,
  localHashChanged: boolean,
  remoteChanges: RemoteStateChanges,
): void => {
  if (localHashChanged) {
    staleReasonCounts.localHashChanged += 1;
  }
  if (remoteChanges.availability) {
    staleReasonCounts.remoteAvailabilityChanged += 1;
  }
  if (remoteChanges.content) {
    staleReasonCounts.remoteContentChanged += 1;
  }
  if (remoteChanges.contentFields?.allDay) {
    staleReasonCounts.remoteContentAllDayChanged += 1;
  }
  if (remoteChanges.contentFields?.description) {
    staleReasonCounts.remoteContentDescriptionChanged += 1;
  }
  if (remoteChanges.contentFields?.location) {
    staleReasonCounts.remoteContentLocationChanged += 1;
  }
  if (remoteChanges.contentFields?.summary) {
    staleReasonCounts.remoteContentSummaryChanged += 1;
  }
  recordRemoteContentLengths(staleReasonCounts, remoteChanges.contentFields);
  if (remoteChanges.time) {
    staleReasonCounts.remoteTimeChanged += 1;
  }
};

/*
 * A mirror missing from the read is only gone when something positively established that.
 * A mapping the read never covered, or could not settle, is unknown: recreating it
 * duplicates a live event and deleting it destroys one, so it is left exactly as it is.
 */
const isRemoteAbsenceEstablished = (
  mappingId: string,
  authoritativeMappingIds?: ReadonlySet<string>,
  unverifiedMappingIds?: ReadonlySet<string>,
): boolean => {
  if (unverifiedMappingIds?.has(mappingId)) {
    return false;
  }
  return !authoritativeMappingIds || authoritativeMappingIds.has(mappingId);
};

const identifyStaleMappings = (
  mappings: EventMapping[],
  localEventIds: Set<string>,
  remoteEventsByMappingId: Map<string, RemoteEvent>,
  localEventsById: Map<string, MaterializedSyncableEvent>,
  authoritativeMappingIds?: ReadonlySet<string>,
  unverifiedMappingIds?: ReadonlySet<string>,
  storedFormIsObservable = false,
): StaleMappingResult => {
  const staleMappingIds: string[] = [];
  const staleMappedEventIds = new Set<string>();
  const staleRemoteMappings: EventMapping[] = [];
  const remoteMissingMappingIds = new Set<string>();
  const staleReasonCounts = createStaleReasonCounts();

  for (const mapping of mappings) {
    const syncEventId = getMappingSyncEventId(mapping);
    const localEventExists = localEventIds.has(syncEventId);
    const remoteEvent = remoteEventsByMappingId.get(mapping.id);
    const remoteReadCoversMapping = isRemoteAbsenceEstablished(
      mapping.id,
      authoritativeMappingIds,
      unverifiedMappingIds,
    );
    if (localEventExists && !remoteEvent && remoteReadCoversMapping) {
      staleReasonCounts.remoteMissing += 1;
      remoteMissingMappingIds.add(mapping.id);
      staleMappingIds.push(mapping.id);
      staleMappedEventIds.add(syncEventId);
      staleRemoteMappings.push(mapping);
      continue;
    }

    if (!localEventExists || !remoteEvent) {
      continue;
    }

    const localEvent = localEventsById.get(syncEventId);
    if (!localEvent) {
      continue;
    }

    const localEventHash = createSyncEventContentHash(localEvent);
    const localHashChanged = mapping.syncEventHash !== localEventHash;
    const remoteChanges = getRemoteStateChanges(
      mapping,
      localEvent,
      remoteEvent,
      storedFormIsObservable,
    );
    const remoteStateChanged = remoteChanges.availability
      || remoteChanges.content
      || remoteChanges.time;

    if (localHashChanged || remoteStateChanged) {
      recordStaleReasons(staleReasonCounts, localHashChanged, remoteChanges);
      staleMappingIds.push(mapping.id);
      staleMappedEventIds.add(syncEventId);
      staleRemoteMappings.push(mapping);
    }
  }

  return {
    remoteMissingMappingIds,
    staleMappedEventIds,
    staleMappingIds,
    staleReasonCounts,
    staleRemoteMappings,
  };
};

const buildAddOperations = (
  localEvents: MaterializedSyncableEvent[],
  existingMappings: EventMapping[],
  staleMappedEventIds: Set<string>,
): SyncOperation[] => {
  const operations: SyncOperation[] = [];
  const mappingsBySyncEventId = new Map<string, EventMapping>();
  for (const mapping of existingMappings) {
    const syncEventId = getMappingSyncEventId(mapping);
    if (!mappingsBySyncEventId.has(syncEventId)) {
      mappingsBySyncEventId.set(syncEventId, mapping);
    }
  }

  for (const event of localEvents) {
    const existingMapping = mappingsBySyncEventId.get(event.id);
    const hasMapping = Boolean(existingMapping);
    const hasStaleMapping = staleMappedEventIds.has(event.id);

    if (!hasMapping || hasStaleMapping) {
      operations.push({
        event,
        type: "add",
        ...(hasStaleMapping && existingMapping && {
          staleMappingId: existingMapping.id,
          ...recordedContentHashFields(existingMapping),
          ...recordedRemoteFormFields(existingMapping),
        }),
      });
    }
  }

  return operations;
};

const buildRemoveOperationsForMappings = (mappings: EventMapping[]): SyncOperation[] =>
  mappings.map((mapping) => ({
    deleteId: mapping.deleteIdentifier,
    mappingId: mapping.id,
    startTime: mapping.startTime,
    type: "remove",
    uid: mapping.destinationEventUid,
  }));

/*
 * A mapping written before delete identifiers were recorded stores the iCalUID, which
 * Google's delete endpoint does not accept: the destination provider spends a second
 * batch request resolving that UID back to an event id, doubling the rate-limit cost
 * of the delete. Reconciliation has just listed the remote copy, so its provider id is
 * already in hand and the lookup is only needed when no remote copy was matched.
 */
const resolveRepairedDeleteIdentifier = (
  mapping: EventMapping,
  remoteEvent: RemoteEvent,
): string => {
  if (mapping.deleteIdentifier === mapping.destinationEventUid) {
    return remoteEvent.deleteId;
  }
  return mapping.deleteIdentifier;
};

const resolveMappingDeleteId = (
  mapping: EventMapping,
  remoteEventsByMappingId: ReadonlyMap<string, RemoteEvent>,
): string => remoteEventsByMappingId.get(mapping.id)?.deleteId ?? mapping.deleteIdentifier;

const buildReplacementOperations = (
  mappings: EventMapping[],
  localEventsById: Map<string, MaterializedSyncableEvent>,
  remoteEventsByMappingId: ReadonlyMap<string, RemoteEvent>,
  remoteMissingMappingIds: ReadonlySet<string>,
): SyncOperation[] => {
  const operations: SyncOperation[] = [];
  for (const mapping of mappings) {
    const event = localEventsById.get(getMappingSyncEventId(mapping));
    if (!event) {
      continue;
    }
    const remoteEvent = remoteEventsByMappingId.get(mapping.id);
    operations.push({
      deleteId: resolveMappingDeleteId(mapping, remoteEventsByMappingId),
      event,
      ...(remoteMissingMappingIds.has(mapping.id) && { remoteMissing: true }),
      staleMappingId: mapping.id,
      type: "replace",
      uid: mapping.destinationEventUid,
      ...recordedContentHashFields(mapping),
      ...recordedRemoteFormFields(mapping),
      ...(remoteEvent && repairedFromContentHashFields(mapping, event, remoteEvent)),
      ...(remoteEvent && settledContentHashFields(mapping, event, remoteEvent)),
    });
  }
  return operations;
};

const getOperationEventTime = (operation: SyncOperation): Date => {
  if (operation.type === "add" || operation.type === "replace") {
    return operation.event.startTime;
  }
  return operation.startTime;
};

const getOperationTypePriority = (operation: SyncOperation): number => {
  if (operation.type === "remove") {
    return 0;
  }
  return 1;
};

const sortOperationsByTime = (operations: SyncOperation[]): SyncOperation[] =>
  operations.toSorted((first, second) => {
    const timeDiff = getOperationEventTime(first).getTime() - getOperationEventTime(second).getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return getOperationTypePriority(first) - getOperationTypePriority(second);
  });

const buildRemoveOperations = (
  existingMappings: EventMapping[],
  remoteEvents: RemoteEvent[],
  localEventIds: Set<string>,
  mappedRemoteIdentities: Set<string>,
  remoteEventsByMappingId: ReadonlyMap<string, RemoteEvent>,
  scope: ReconciliationScope,
): SyncOperation[] => {
  const operations: SyncOperation[] = [];

  for (const mapping of existingMappings) {
    /*
     * Both edges of the requested window retire a mapping. A mirror the window no
     * longer covers stops receiving updates, and a stale copy that never reflects a
     * rename, move, or deletion of its source reads as broken sync. The source event
     * itself is retained in Keeper's own store, so retiring the mirror narrows scope
     * rather than losing data.
     */
    const outsideCleanupWindow = !overlapsTimeWindow(
      mapping,
      scope.requestedWindow.timeMin,
      scope.requestedWindow.timeMax,
    );
    const insideAuthoritativeWindow = isInsideSourceAuthoritativeWindow(
      mapping,
      mapping.sourceCalendarId,
      scope,
    );
    /*
     * A series withheld for exceeding the occurrence budget is absent from the local
     * read for a technical limit, not because it is gone. Deleting its mirrors here
     * would mass-delete and then mass-re-add them the moment the window changes, so
     * the missing-source path leaves them alone. Window cleanup above still applies.
     */
    const isWithheldSeriesMapping = mapping.eventStateId !== null
      && Boolean(scope.withheldSourceEventStateIds?.has(mapping.eventStateId));
    if (
      outsideCleanupWindow
      || insideAuthoritativeWindow
        && !isWithheldSeriesMapping
        && !localEventIds.has(getMappingSyncEventId(mapping))
    ) {
      operations.push({
        deleteId: resolveMappingDeleteId(mapping, remoteEventsByMappingId),
        mappingId: mapping.id,
        startTime: mapping.startTime,
        type: "remove",
        uid: mapping.destinationEventUid,
      });
    }
  }

  for (const remoteEvent of remoteEvents) {
    if (mappedRemoteIdentities.has(`${remoteEvent.uid}\u0000${remoteEvent.deleteId}`)) {
      continue;
    }

    if (!remoteEvent.isKeeperEvent) {
      continue;
    }

    if (scope.authoritativeMappingIds) {
      continue;
    }

    if (!scope.authoritativeWindow || !overlapsTimeWindow(
      remoteEvent,
      scope.authoritativeWindow.timeMin,
      scope.authoritativeWindow.timeMax,
    )) {
      continue;
    }

    operations.push({
      deleteId: remoteEvent.deleteId,
      startTime: remoteEvent.startTime,
      type: "remove",
      uid: remoteEvent.uid,
    });
  }

  return operations;
};

interface RecordedRemoteForm {
  remoteAvailability: EventAvailability | null;
  remoteContentHash: string | null;
  remoteContentHashRepairedFrom: string | null;
  remoteTimes: RecordedRemoteTimes;
}

const resolveRecordedRemoteForm = (
  mapping: EventMapping,
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
  storedFormIsObservable: boolean,
): RecordedRemoteForm => ({
  remoteAvailability: resolveRecordedRemoteAvailability(
    mapping,
    localEvent,
    remoteEvent,
    storedFormIsObservable,
  ),
  remoteContentHash: resolveRecordedRemoteContentHash(mapping, localEvent, remoteEvent),
  remoteContentHashRepairedFrom: resolveRecordedRepairedFrom(mapping, remoteEvent),
  remoteTimes: resolveRecordedRemoteTimes(mapping, remoteEvent),
});

const hasRecordedRemoteForm = (
  mapping: EventMapping,
  recorded: RecordedRemoteForm,
): boolean => {
  const mappingRemoteTimes = getRecordedRemoteTimes(mapping);
  return recorded.remoteContentHash === getRecordedRemoteContentHash(mapping)
    && recorded.remoteContentHashRepairedFrom === getRepairedFromContentHash(mapping)
    && recorded.remoteAvailability === getRecordedRemoteAvailability(mapping)
    && isSameRecordedInstant(recorded.remoteTimes.remoteStartTime, mappingRemoteTimes.remoteStartTime)
    && isSameRecordedInstant(recorded.remoteTimes.remoteEndTime, mappingRemoteTimes.remoteEndTime);
};

/* Null when the mapping already records what the destination holds and needs no delete-id repair. */
const buildRecordingMappingUpdate = (
  mapping: EventMapping,
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
  storedFormIsObservable: boolean,
): MappingUpdate | null => {
  const recorded = resolveRecordedRemoteForm(
    mapping,
    localEvent,
    remoteEvent,
    storedFormIsObservable,
  );
  const needsDeleteIdentifierRepair = mapping.deleteIdentifier === mapping.destinationEventUid
    && remoteEvent.deleteId !== mapping.deleteIdentifier;
  if (!needsDeleteIdentifierRepair && hasRecordedRemoteForm(mapping, recorded)) {
    return null;
  }

  return {
    deleteIdentifier: resolveRepairedDeleteIdentifier(mapping, remoteEvent),
    endTime: localEvent.endTime,
    id: mapping.id,
    remoteAvailability: recorded.remoteAvailability,
    ...recordedContentHashUpdate(recorded.remoteContentHash),
    ...repairedFromUpdate(mapping, recorded.remoteContentHashRepairedFrom),
    remoteEndTime: recorded.remoteTimes.remoteEndTime,
    remoteStartTime: recorded.remoteTimes.remoteStartTime,
    startTime: localEvent.startTime,
    syncEventHash: createSyncEventContentHash(localEvent),
    syncEventId: localEvent.id,
  };
};

const computeSyncOperations = (
  localEvents: MaterializedSyncableEvent[],
  existingMappings: EventMapping[],
  remoteEvents: RemoteEvent[],
  scope: ReconciliationScope,
): ComputeSyncOperationsResult => {
  const storedFormIsObservable = scope.storedFormIsObservable ?? false;
  const authoritativeLocalEvents: MaterializedSyncableEvent[] = [];
  const activeMappings: EventMapping[] = [];
  authoritativeLocalEvents.push(...localEvents.filter((event) =>
    isInsideSourceAuthoritativeWindow(event, event.calendarId, scope)));
  activeMappings.push(...existingMappings.filter((mapping) =>
    isInsideSourceAuthoritativeWindow(mapping, mapping.sourceCalendarId, scope)));
  const localEventIds = new Set(authoritativeLocalEvents.map((event) => event.id));
  const localEventsById = new Map(authoritativeLocalEvents.map((event) => [event.id, event]));
  const remoteEventsByMappingId = matchRemoteEventsToMappings(existingMappings, remoteEvents);
  const occurrenceReassignments = pairReidentifiedMaterializedOccurrences(
    authoritativeLocalEvents,
    activeMappings,
    existingMappings,
  );
  const databaseOnlyReassignments: OccurrenceReassignment[] = [];
  const remoteReassignments: OccurrenceReassignment[] = [];
  for (const reassignment of occurrenceReassignments) {
    const { event, mapping } = reassignment;
    const remoteEvent = remoteEventsByMappingId.get(mapping.id);
    const mappingMatchesOccurrence = isSameSerializedSecond(mapping.startTime, event.startTime)
      && isSameSerializedSecond(mapping.endTime, event.endTime);
    const remoteStateIsVerifiable = typeof remoteEvent?.editableAvailability === "string"
      && typeof remoteEvent.editableContentHash === "string";
    if (
      remoteEvent
      && remoteStateIsVerifiable
      && mappingMatchesOccurrence
      && !hasRemoteStateChanged(mapping, event, remoteEvent, storedFormIsObservable)
      && remoteHoldsOccurrenceContent(event, remoteEvent)
    ) {
      databaseOnlyReassignments.push(reassignment);
    } else {
      remoteReassignments.push(reassignment);
    }
  }
  const reassignedMappingIds = new Set(
    occurrenceReassignments.map(({ mapping }) => mapping.id),
  );
  const reassignedEventIds = new Set(
    occurrenceReassignments.map(({ event }) => event.id),
  );
  const standardMappings = activeMappings.filter(
    (mapping) => !reassignedMappingIds.has(mapping.id),
  );
  const mappedRemoteIdentities = new Set(
    [...remoteEventsByMappingId.values()].map((remoteEvent) =>
      getRemoteIdentity(remoteEvent.uid, remoteEvent.deleteId)),
  );

  const {
    remoteMissingMappingIds,
    staleMappingIds,
    staleMappedEventIds,
    staleReasonCounts,
    staleRemoteMappings,
  } = identifyStaleMappings(
      standardMappings,
      localEventIds,
      remoteEventsByMappingId,
      localEventsById,
      scope.authoritativeMappingIds,
      scope.unverifiedMappingIds,
      storedFormIsObservable,
    );
  const staleMappingIdSet = new Set(staleMappingIds);
  const mappingUpdatesById = new Map<string, MappingUpdate>();
  for (const mapping of standardMappings) {
    const remoteEvent = remoteEventsByMappingId.get(mapping.id);
    const localEvent = localEventsById.get(getMappingSyncEventId(mapping));
    if (staleMappingIdSet.has(mapping.id) || !localEvent || !remoteEvent) {
      continue;
    }
    const mappingUpdate = buildRecordingMappingUpdate(
      mapping,
      localEvent,
      remoteEvent,
      storedFormIsObservable,
    );
    if (mappingUpdate === null) {
      continue;
    }
    mappingUpdatesById.set(mapping.id, mappingUpdate);
  }
  for (const { event, mapping } of databaseOnlyReassignments) {
    const remoteEvent = remoteEventsByMappingId.get(mapping.id);
    if (!remoteEvent) {
      continue;
    }
    const recorded = resolveRecordedRemoteForm(
      mapping,
      event,
      remoteEvent,
      storedFormIsObservable,
    );
    mappingUpdatesById.set(mapping.id, {
      deleteIdentifier: remoteEvent.deleteId,
      endTime: event.endTime,
      id: mapping.id,
      remoteAvailability: recorded.remoteAvailability,
      ...recordedContentHashUpdate(recorded.remoteContentHash),
      ...repairedFromUpdate(mapping, recorded.remoteContentHashRepairedFrom),
      remoteEndTime: recorded.remoteTimes.remoteEndTime,
      remoteStartTime: recorded.remoteTimes.remoteStartTime,
      startTime: event.startTime,
      syncEventHash: createSyncEventContentHash(event),
      syncEventId: event.id,
    });
  }

  const replacedEventIds = new Set(
    staleRemoteMappings.map((mapping) => getMappingSyncEventId(mapping)),
  );
  /*
   * Matched against every existing mapping, not just authoritative ones: a mapping
   * between recorded coverage and the requested edge would otherwise look unmapped
   * and be re-added, while its insert is dropped by the mapping uniqueness index
   * and the orphaned remote event is deleted on the next run, forever.
   */
  const addOperations = buildAddOperations(
    authoritativeLocalEvents,
    existingMappings,
    staleMappedEventIds,
  )
    .filter((operation) => operation.type !== "add"
      || !replacedEventIds.has(operation.event.id)
        && !reassignedEventIds.has(operation.event.id));
  const replacementOperations = buildReplacementOperations(
    staleRemoteMappings,
    localEventsById,
    remoteEventsByMappingId,
    remoteMissingMappingIds,
  );
  const reassignmentOperations: SyncOperation[] = remoteReassignments.map(({
    event,
    mapping,
  }) => ({
    deleteId: resolveMappingDeleteId(mapping, remoteEventsByMappingId),
    event,
    staleMappingId: mapping.id,
    type: "replace",
    uid: mapping.destinationEventUid,
  }));

  const removeOperations = buildRemoveOperations(
    existingMappings.filter((mapping) => !reassignedMappingIds.has(mapping.id)),
    remoteEvents,
    localEventIds,
    mappedRemoteIdentities,
    remoteEventsByMappingId,
    scope,
  );

  return {
    mappingUpdates: [...mappingUpdatesById.values()],
    operations: sortOperationsByTime([
      ...addOperations,
      ...removeOperations,
      ...replacementOperations,
      ...reassignmentOperations,
    ]),
    staleReasonCounts: {
      ...staleReasonCounts,
      occurrenceReassigned: remoteReassignments.length,
    },
    staleMappingIds: [
      ...staleMappingIds,
      ...remoteReassignments.map(({ mapping }) => mapping.id),
    ],
  };
};

export {
  buildAddOperations,
  buildRemoveOperations,
  buildRemoveOperationsForMappings,
  buildReplacementOperations,
  computeSyncOperations,
  identifyStaleMappings,
  matchRemoteEventsToMappings,
  pairReidentifiedMaterializedOccurrences,
};
export type {
  ComputeSyncOperationsResult,
  MappingUpdate,
  OccurrenceReassignment,
  ReconciliationScope,
  StaleMappingResult,
  StaleReasonCounts,
};
