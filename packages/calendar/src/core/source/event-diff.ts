import type { SourceEvent } from "../types";
import type { IcsExceptionDates, IcsRecurrenceRule } from "ts-ics";
import stringify from "fast-json-stable-stringify";
import { buildSourceEventInstanceKey } from "./event-instance";
import type { ExistingSourceEventState } from "./stored-event-state";

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

const serializeStructuredIdentityValue = (
  value: IcsExceptionDates | IcsRecurrenceRule | null | undefined,
): string => {
  if (value === null || value === globalThis.undefined) {
    return "";
  }

  return stringify(value);
};

const resolveExistingSourceEventInstanceKey = (
  event: ExistingSourceEventState,
): string => event.sourceEventInstanceKey ?? buildSourceEventInstanceKey({
  endTime: event.endTime,
  recurrenceId: event.recurrenceId,
  startTime: event.startTime,
  uid: event.sourceEventUid ?? "",
});

interface SourceEventIdentityInput {
  sourceEventId?: string | null;
  sourceEventInstanceKey: string;
  sourceEventUid: string;
  startTime: Date;
  endTime: Date;
  isAllDay?: boolean | null;
  availability?: string | null;
  sourceEventType?: string | null;
  title?: string | null;
  description?: string | null;
  location?: string | null;
  exceptionDates?: IcsExceptionDates | null;
  recurrenceId?: Date | null;
  recurrenceRule?: IcsRecurrenceRule | null;
  startTimeZone?: string | null;
}

const buildSourceEventIdentityKey = (
  input: SourceEventIdentityInput,
  options: SourceEventIdentityOptions = {},
): string =>
  [
    input.sourceEventId ?? "",
    input.sourceEventUid,
    input.sourceEventInstanceKey,
    input.startTime.toISOString(),
    input.endTime.toISOString(),
    normalizeIdentityIsAllDay(input.isAllDay, options),
    input.availability ?? "",
    input.sourceEventType ?? "default",
    normalizeIdentityContent(input.title),
    normalizeIdentityContent(input.description),
    normalizeIdentityContent(input.location),
    normalizeIdentityContent(input.startTimeZone),
    serializeStructuredIdentityValue(input.recurrenceRule),
    serializeStructuredIdentityValue(input.exceptionDates),
    input.recurrenceId?.toISOString() ?? "",
  ].join("|");

const deduplicateIncomingEvents = (incomingEvents: SourceEvent[]): SourceEvent[] => {
  const dedupedEvents = new Map<string, SourceEvent>();

  for (const incomingEvent of incomingEvents) {
    if (incomingEvent.sourceEventId) {
      dedupedEvents.set(`provider:${incomingEvent.sourceEventId}`, incomingEvent);
      continue;
    }

    const storageIdentity = `instance:${buildSourceEventInstanceKey(incomingEvent)}`;
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
          exceptionDates: existingEvent.exceptionDates,
          isAllDay: existingEvent.isAllDay,
          location: existingEvent.location,
          recurrenceId: existingEvent.recurrenceId,
          recurrenceRule: existingEvent.recurrenceRule,
          sourceEventInstanceKey: resolveExistingSourceEventInstanceKey(existingEvent),
          sourceEventType: existingEvent.sourceEventType,
          sourceEventId: existingEvent.sourceEventId,
          sourceEventUid: existingEvent.sourceEventUid,
          startTime: existingEvent.startTime,
          startTimeZone: existingEvent.startTimeZone,
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
            exceptionDates: incomingEvent.exceptionDates,
            isAllDay: incomingEvent.isAllDay,
            location: incomingEvent.location,
            recurrenceId: incomingEvent.recurrenceId,
            recurrenceRule: incomingEvent.recurrenceRule,
            sourceEventInstanceKey: buildSourceEventInstanceKey(incomingEvent),
            sourceEventType: incomingEvent.sourceEventType,
            sourceEventId: incomingEvent.sourceEventId,
            sourceEventUid: incomingEvent.uid,
            startTime: incomingEvent.startTime,
            startTimeZone: incomingEvent.startTimeZone,
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

      return [buildSourceEventInstanceKey(incomingEvent)];
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

          return providerBackedStorageIdentitySet.has(
            resolveExistingSourceEventInstanceKey(existingEvent),
          );
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
      buildSourceEventInstanceKey(incomingEvent)),
  );

  return existingEvents
    .filter((existingEvent) => {
      if (existingEvent.sourceEventId) {
        return !incomingProviderIdSet.has(existingEvent.sourceEventId);
      }

      if (existingEvent.sourceEventUid === null) {
        return false;
      }

      const existingStorageIdentityKey = resolveExistingSourceEventInstanceKey(existingEvent);

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
export type { SourceEventDiffOptions };
export type { ExistingSourceEventState } from "./stored-event-state";
