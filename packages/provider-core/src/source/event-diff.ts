import type { SourceEvent } from "../types";

interface ExistingSourceEventState {
  availability?: string | null;
  id: string;
  isAllDay?: boolean | null;
  sourceEventType?: string | null;
  sourceEventUid: string | null;
  startTime: Date;
  endTime: Date;
}

interface SourceEventDiffOptions {
  isDeltaSync?: boolean;
  cancelledEventUids?: string[];
}

interface SourceEventIdentityOptions {
  normalizeMissingMetadata?: boolean;
}

const normalizeIdentityIsAllDay = (
  isAllDay: boolean | null | undefined,
  options: SourceEventIdentityOptions,
): string => {
  if (options.normalizeMissingMetadata) {
    return String(isAllDay ?? false);
  }

  return String(isAllDay);
};

const buildSourceEventIdentityKey = (
  sourceEventUid: string,
  startTime: Date,
  endTime: Date,
  isAllDay?: boolean | null,
  availability?: string | null,
  sourceEventType?: string | null,
  options: SourceEventIdentityOptions = {},
): string =>
  `${sourceEventUid}|${startTime.toISOString()}|${endTime.toISOString()}|${
    normalizeIdentityIsAllDay(isAllDay, options)
  }|${availability ?? ""}|${sourceEventType ?? "default"}`;

const buildSourceEventStorageIdentityKey = (
  sourceEventUid: string,
  startTime: Date,
  endTime: Date,
): string => `${sourceEventUid}|${startTime.toISOString()}|${endTime.toISOString()}`;

const deduplicateIncomingEvents = (incomingEvents: SourceEvent[]): SourceEvent[] => {
  const dedupedByStorageIdentity = new Map<string, SourceEvent>();

  for (const incomingEvent of incomingEvents) {
    const storageIdentity = buildSourceEventStorageIdentityKey(
      incomingEvent.uid,
      incomingEvent.startTime,
      incomingEvent.endTime,
    );
    dedupedByStorageIdentity.set(storageIdentity, incomingEvent);
  }

  return [...dedupedByStorageIdentity.values()];
};

const buildExistingEventIdentitySet = (
  existingEvents: ExistingSourceEventState[],
  options: SourceEventIdentityOptions = {},
): Set<string> => {
  const identities = new Set<string>();

  for (const existingEvent of existingEvents) {
    if (existingEvent.sourceEventUid === null) {
      continue;
    }

    identities.add(
      buildSourceEventIdentityKey(
        existingEvent.sourceEventUid,
        existingEvent.startTime,
        existingEvent.endTime,
        existingEvent.isAllDay,
        existingEvent.availability,
        existingEvent.sourceEventType,
        options,
      ),
    );
  }

  return identities;
};

const buildSourceEventsToAdd = (
  existingEvents: ExistingSourceEventState[],
  incomingEvents: SourceEvent[],
  options: SourceEventDiffOptions = {},
): SourceEvent[] => {
  const normalizedIncomingEvents = deduplicateIncomingEvents(incomingEvents);
  const existingIdentities = buildExistingEventIdentitySet(existingEvents, {
    normalizeMissingMetadata: options.isDeltaSync ?? false,
  });

  return normalizedIncomingEvents.filter(
    (incomingEvent) =>
      !existingIdentities.has(
        buildSourceEventIdentityKey(
          incomingEvent.uid,
          incomingEvent.startTime,
          incomingEvent.endTime,
          incomingEvent.isAllDay,
          incomingEvent.availability,
          incomingEvent.sourceEventType,
          { normalizeMissingMetadata: options.isDeltaSync ?? false },
        ),
      ),
  );
};

const buildSourceEventStateIdsToRemove = (
  existingEvents: ExistingSourceEventState[],
  incomingEvents: SourceEvent[],
  options: SourceEventDiffOptions = {},
): string[] => {
  const normalizedIncomingEvents = deduplicateIncomingEvents(incomingEvents);
  const { isDeltaSync = false, cancelledEventUids } = options;

  if (isDeltaSync) {
    if (!cancelledEventUids || cancelledEventUids.length === 0) {
      return [];
    }

    const cancelledUidSet = new Set(cancelledEventUids);

    return existingEvents
      .filter(
        (existingEvent) =>
          existingEvent.sourceEventUid !== null
          && cancelledUidSet.has(existingEvent.sourceEventUid),
      )
      .map((existingEvent) => existingEvent.id);
  }

  const incomingIdentitySet = new Set(
    normalizedIncomingEvents.map((incomingEvent) =>
      buildSourceEventIdentityKey(
        incomingEvent.uid,
        incomingEvent.startTime,
        incomingEvent.endTime,
        incomingEvent.isAllDay,
        incomingEvent.availability,
        incomingEvent.sourceEventType,
        { normalizeMissingMetadata: isDeltaSync },
      )),
  );

  return existingEvents
    .filter((existingEvent) => {
      if (existingEvent.sourceEventUid === null) {
        return false;
      }

      const existingIdentityKey = buildSourceEventIdentityKey(
        existingEvent.sourceEventUid,
        existingEvent.startTime,
        existingEvent.endTime,
        existingEvent.isAllDay,
        existingEvent.availability,
        existingEvent.sourceEventType,
        { normalizeMissingMetadata: isDeltaSync },
      );

      return !incomingIdentitySet.has(existingIdentityKey);
    })
    .map((existingEvent) => existingEvent.id);
};

export {
  buildSourceEventIdentityKey,
  buildSourceEventsToAdd,
  buildSourceEventStateIdsToRemove,
};
export type { ExistingSourceEventState, SourceEventDiffOptions };
