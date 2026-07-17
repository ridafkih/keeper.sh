import type { SourceEvent } from "../types";

interface ExistingSourceEventState {
  availability?: string | null;
  description?: string | null;
  id: string;
  isAllDay?: boolean | null;
  location?: string | null;
  sourceEventType?: string | null;
  sourceEventId?: string | null;
  sourceEventUid: string | null;
  startTime: Date;
  endTime: Date;
  title?: string | null;
}

interface SourceEventDiffOptions {
  changedEventIds?: string[];
  isDeltaSync?: boolean;
  cancelledEventIds?: string[];
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
  sourceEventId?: string | null;
  sourceEventUid: string;
  startTime: Date;
  endTime: Date;
  isAllDay?: boolean | null;
  availability?: string | null;
  sourceEventType?: string | null;
  title?: string | null;
  description?: string | null;
  location?: string | null;
}

const buildSourceEventIdentityKey = (
  input: SourceEventIdentityInput,
  options: SourceEventIdentityOptions = {},
): string =>
  [
    input.sourceEventId ?? "",
    input.sourceEventUid,
    input.startTime.toISOString(),
    input.endTime.toISOString(),
    normalizeIdentityIsAllDay(input.isAllDay, options),
    input.availability ?? "",
    input.sourceEventType ?? "default",
    normalizeIdentityContent(input.title),
    normalizeIdentityContent(input.description),
    normalizeIdentityContent(input.location),
  ].join("|");

const buildSourceEventStorageIdentityKey = (
  sourceEventUid: string,
  startTime: Date,
  endTime: Date,
): string => `${sourceEventUid}|${startTime.toISOString()}|${endTime.toISOString()}`;

const deduplicateIncomingEvents = (incomingEvents: SourceEvent[]): SourceEvent[] => {
  const dedupedEvents = new Map<string, SourceEvent>();

  for (const incomingEvent of incomingEvents) {
    if (incomingEvent.sourceEventId) {
      dedupedEvents.set(`provider:${incomingEvent.sourceEventId}`, incomingEvent);
      continue;
    }

    const storageIdentity = `storage:${buildSourceEventStorageIdentityKey(
      incomingEvent.uid,
      incomingEvent.startTime,
      incomingEvent.endTime,
    )}`;
    dedupedEvents.set(storageIdentity, incomingEvent);
  }

  return [...dedupedEvents.values()];
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
          endTime: existingEvent.endTime,
          isAllDay: existingEvent.isAllDay,
          location: existingEvent.location,
          sourceEventType: existingEvent.sourceEventType,
          sourceEventId: existingEvent.sourceEventId,
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
            endTime: incomingEvent.endTime,
            isAllDay: incomingEvent.isAllDay,
            location: incomingEvent.location,
            sourceEventType: incomingEvent.sourceEventType,
            sourceEventId: incomingEvent.sourceEventId,
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
  const { changedEventIds, isDeltaSync = false, cancelledEventIds } = options;
  const incomingProviderIdSet = new Set(
    normalizedIncomingEvents.flatMap((incomingEvent) => {
      if (!incomingEvent.sourceEventId) {
        return [];
      }
      return [incomingEvent.sourceEventId];
    }),
  );
  const providerBackedStorageIdentitySet = new Set(
    normalizedIncomingEvents.flatMap((incomingEvent) => {
      if (!incomingEvent.sourceEventId) {
        return [];
      }

      return [buildSourceEventStorageIdentityKey(
        incomingEvent.uid,
        incomingEvent.startTime,
        incomingEvent.endTime,
      )];
    }),
  );

  if (isDeltaSync) {
    const changedEventIdSet = new Set(changedEventIds);
    const cancelledEventIdSet = new Set(cancelledEventIds);
    const changedEventsById = new Map(
      normalizedIncomingEvents.flatMap((event) => {
        if (!event.sourceEventId) {
          return [];
        }
        return [[event.sourceEventId, event] as const];
      }),
    );

    return existingEvents
      .filter((existingEvent) => {
        if (!existingEvent.sourceEventId) {
          if (existingEvent.sourceEventUid === null) {
            return false;
          }

          const existingStorageIdentity = buildSourceEventStorageIdentityKey(
            existingEvent.sourceEventUid,
            existingEvent.startTime,
            existingEvent.endTime,
          );
          return providerBackedStorageIdentitySet.has(existingStorageIdentity);
        }

        if (cancelledEventIdSet.has(existingEvent.sourceEventId)) {
          return true;
        }

        if (!changedEventIdSet.has(existingEvent.sourceEventId)) {
          return false;
        }

        return !changedEventsById.has(existingEvent.sourceEventId);
      })
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
      if (existingEvent.sourceEventId) {
        return !incomingProviderIdSet.has(existingEvent.sourceEventId);
      }

      if (existingEvent.sourceEventUid === null) {
        return false;
      }

      const existingStorageIdentityKey = buildSourceEventStorageIdentityKey(
        existingEvent.sourceEventUid,
        existingEvent.startTime,
        existingEvent.endTime,
      );

      if (providerBackedStorageIdentitySet.has(existingStorageIdentityKey)) {
        return true;
      }

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
