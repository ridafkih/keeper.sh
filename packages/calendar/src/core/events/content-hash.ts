import type { SyncableEvent } from "../types";
import { resolveIsAllDayEvent } from "./all-day";
import stringify from "fast-json-stable-stringify";

type SyncableEventContent = Pick<SyncableEvent, "summary" | "description" | "location">
  & Partial<Pick<
    SyncableEvent,
    | "availability"
    | "isAllDay"
    | "startTime"
    | "endTime"
    | "startTimeZone"
    | "recurrenceRule"
    | "recurrenceDuration"
    | "exceptionDates"
    | "recurrenceId"
  >>;

const normalizeText = (value?: string): string =>
  value?.replaceAll(/\r\n?/g, "\n").trim() ?? "";
const normalizeAvailability = (value?: SyncableEvent["availability"]): string => value ?? "busy";
const resolveHashedAllDay = (event: SyncableEventContent): boolean => {
  if (event.startTime && event.endTime) {
    return resolveIsAllDayEvent({
      endTime: event.endTime,
      isAllDay: event.isAllDay,
      startTime: event.startTime,
    });
  }

  return event.isAllDay ?? false;
};

const createSyncEventContentHash = (event: SyncableEventContent): string => {
  const payload = JSON.stringify([
    normalizeText(event.summary),
    normalizeText(event.description),
    normalizeText(event.location),
    normalizeAvailability(event.availability),
    resolveHashedAllDay(event),
    event.startTime?.toISOString() ?? "",
    event.endTime?.toISOString() ?? "",
    event.startTimeZone ?? "",
    stringify(event.recurrenceDuration ?? null),
    stringify(event.recurrenceRule ?? null),
    [...event.exceptionDates ?? []].map((date) => date.toISOString()).toSorted(),
    event.recurrenceId?.toISOString() ?? "",
  ]);

  return new Bun.CryptoHasher("sha256").update(payload).digest("hex");
};

interface EditableEventContentSnapshot {
  summary: string;
  description: string;
  location: string;
  isAllDay: boolean;
}

const createEditableEventContentSnapshot = (
  event: SyncableEventContent,
): EditableEventContentSnapshot => ({
  description: normalizeText(event.description),
  isAllDay: resolveHashedAllDay(event),
  location: normalizeText(event.location),
  summary: normalizeText(event.summary),
});

const hashEditableEventContentSnapshot = (snapshot: EditableEventContentSnapshot): string => {
  const payload = JSON.stringify([
    snapshot.summary,
    snapshot.description,
    snapshot.location,
    snapshot.isAllDay,
  ]);

  return new Bun.CryptoHasher("sha256").update(payload).digest("hex");
};

const createEditableEventContentHash = (event: SyncableEventContent): string =>
  hashEditableEventContentSnapshot(createEditableEventContentSnapshot(event));

export {
  createEditableEventContentHash,
  createEditableEventContentSnapshot,
  createSyncEventContentHash,
  hashEditableEventContentSnapshot,
  normalizeText,
};
export type { EditableEventContentSnapshot, SyncableEventContent };
