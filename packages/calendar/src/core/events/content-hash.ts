import type { SyncableEvent } from "../types";
import { resolveIsAllDayEvent } from "./all-day";

type SyncableEventContent = Pick<SyncableEvent, "summary" | "description" | "location">
  & Partial<Pick<SyncableEvent, "availability" | "isAllDay" | "startTime" | "endTime">>;

const normalizeText = (value?: string): string => value?.trim() ?? "";
const normalizeAvailability = (value?: SyncableEvent["availability"]): string => value ?? "";
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
  ]);

  return new Bun.CryptoHasher("sha256").update(payload).digest("hex");
};

export { createSyncEventContentHash };
export type { SyncableEventContent };
