import type { SourceEvent } from "../types";

interface ExistingSourceEventState {
  availability?: string | null;
  description?: string | null;
  plaintextDescription?: string | null;
  id: string;
  isAllDay?: boolean | null;
  location?: string | null;
  sourceEventType?: string | null;
  sourceEventUid: string | null;
  startTime: Date;
  endTime: Date;
  title?: string | null;
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

const normalizeIdentityContent = (value: string | null | undefined): string =>
  value?.trim() ?? "";

interface SourceEventIdentityInput {
  sourceEventUid: string;
  startTime: Date;
  endTime: Date;
  isAllDay?: boolean | null;
  availability?: string | null;
  sourceEventType?: string | null;
  title?: string | null;
  description?: string | null;
  plaintextDescription?: string | null;
  location?: string | null;
}

const buildSourceEventIdentityKey = (
  input: SourceEventIdentityInput,
  options: SourceEventIdentityOptions = {},
): string =>
  [
    input.sourceEventUid,
    input.startTime.toISOString(),
    input.endTime.toISOString(),
    normalizeIdentityIsAllDay(input.isAllDay, options),
    input.availability ?? "",
    input.sourceEventType ?? "default",
    normalizeIdentityContent(input.title),
    normalizeIdentityContent(input.description),
    normalizeIdentityContent(input.plaintextDescription),
    normalizeIdentityContent(input.location),
  ].join("|");

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
        {
          availability: existingEvent.availability,
          description: existingEvent.description,
          plaintextDescription: existingEvent.plaintextDescription,
          endTime: existingEvent.endTime,
          isAllDay: existingEvent.isAllDay,
          location: existingEvent.location,
          sourceEventType: existingEvent.sourceEventType,
          sourceEventUid: existingEvent.sourceEventUid,
          startTime: existingEvent.startTime,
          title: existingEvent.title,
        },
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
          {
            availability: incomingEvent.availability,
            description: incomingEvent.description,
            plaintextDescription: incomingEvent.plaintextDescription,
            endTime: incomingEvent.endTime,
            isAllDay: incomingEvent.isAllDay,
            location: incomingEvent.location,
            sourceEventType: incomingEvent.sourceEventType,
            sourceEventUid: incomingEvent.uid,
            startTime: incomingEvent.startTime,
            title: incomingEvent.title,
          },
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

  const incomingStorageIdentitySet = new Set(
    normalizedIncomingEvents.map((incomingEvent) =>
      buildSourceEventStorageIdentityKey(
        incomingEvent.uid,
        incomingEvent.startTime,
        incomingEvent.endTime,
      )),
  );

  return existingEvents
    .filter((existingEvent) => {
      if (existingEvent.sourceEventUid === null) {
        return false;
      }

      const existingStorageIdentityKey = buildSourceEventStorageIdentityKey(
        existingEvent.sourceEventUid,
        existingEvent.startTime,
        existingEvent.endTime,
      );

      return !incomingStorageIdentitySet.has(existingStorageIdentityKey);
    })
    .map((existingEvent) => existingEvent.id);
};

export {
  buildSourceEventIdentityKey,
  buildSourceEventsToAdd,
  buildSourceEventStateIdsToRemove,
};
export type { ExistingSourceEventState, SourceEventDiffOptions };
