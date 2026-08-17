import type { ProviderSeed } from "@keeper.sh/sync-conformance";
import type { CalendarKey, RemoteEvent } from "@keeper.sh/sync-protocol";
import type { BodyType, Event as GraphEvent, EventType } from "@microsoft/microsoft-graph-types";
import { provenanceCategory, provenancePropertyName } from "../../src/decode/provenance";
import { microsoftCalendar } from "./harness";

interface TimedDraft {
  readonly id: string;
  readonly uid?: string | null;
  readonly start: string;
  readonly end: string;
  readonly subject?: string | null;
  readonly description?: string;
  readonly location?: string;
  readonly changeKey?: string;
  readonly lastModified?: string;
  readonly created?: string;
  readonly timeZone?: string;
  readonly originalStartTimeZone?: string | null;
  readonly type?: EventType;
  readonly seriesMasterId?: string | null;
  readonly bodyContentType?: BodyType;
}

const subjectOf = (draft: TimedDraft): string | null => {
  if (!Object.hasOwn(draft, "subject")) {
    return draft.id;
  }
  return draft.subject ?? null;
};

const uidOf = (draft: TimedDraft): string | null => {
  if (!Object.hasOwn(draft, "uid")) {
    return `${draft.id}-uid`;
  }
  return draft.uid ?? null;
};

const timedItem = (draft: TimedDraft): GraphEvent => ({
  id: draft.id,
  iCalUId: uidOf(draft),
  changeKey: draft.changeKey ?? `ck-1-${draft.id}`,
  subject: subjectOf(draft),
  body: { contentType: draft.bodyContentType ?? "text", content: draft.description ?? "" },
  location: { displayName: draft.location ?? "" },
  showAs: "busy",
  sensitivity: "normal",
  isAllDay: false,
  isCancelled: false,
  type: draft.type ?? "singleInstance",
  seriesMasterId: draft.seriesMasterId ?? null,
  originalStartTimeZone: draft.originalStartTimeZone ?? "UTC",
  originalEndTimeZone: draft.originalStartTimeZone ?? "UTC",
  createdDateTime: draft.created ?? "2026-03-01T00:00:00.000Z",
  lastModifiedDateTime: draft.lastModified ?? "2026-03-11T00:00:00.000Z",
  start: { dateTime: draft.start, timeZone: draft.timeZone ?? "UTC" },
  end: { dateTime: draft.end, timeZone: draft.timeZone ?? "UTC" },
  categories: [],
});

const allDayItem = (id: string, startDate: string, endDateExclusive: string): GraphEvent => ({
  ...timedItem({ id, start: `${startDate}T00:00:00.0000000`, end: `${endDateExclusive}T00:00:00.0000000` }),
  isAllDay: true,
});

const seriesMasterItem = (id: string, start: string): GraphEvent => ({
  ...timedItem({ id, start, end: start, type: "seriesMaster" }),
  recurrence: {
    pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday"] },
    range: { type: "noEnd", startDate: start.slice(0, 10) },
  },
});

const occurrenceItem = (id: string, masterId: string, start: string, end: string): GraphEvent =>
  timedItem({ id, start, end, type: "occurrence", seriesMasterId: masterId });

const ourItem = (id: string, installation: string, marker: "property" | "category" | "uid"): GraphEvent => {
  const base = timedItem({ id, start: "2026-03-12T09:00:00.0000000", end: "2026-03-12T10:00:00.0000000" });
  if (marker === "property") {
    return { ...base, singleValueExtendedProperties: [{ id: provenancePropertyName, value: installation }] };
  }
  if (marker === "category") {
    return { ...base, categories: [provenanceCategory] };
  }
  return { ...base, iCalUId: `keeper-sh-${id}` };
};

const removedItem = (id: string, reason: string | null): unknown => {
  if (reason === null) {
    return { id, "@removed": {} };
  }
  return { id, "@removed": { reason } };
};

interface ForeignDraft {
  readonly uid: string;
  readonly start: string;
  readonly end: string;
  readonly revision?: number;
  readonly calendar?: CalendarKey;
  readonly title?: string;
  readonly description?: string | null;
  readonly location?: string | null;
}

const foreignEvent = (draft: ForeignDraft): RemoteEvent => {
  const revision = draft.revision ?? 1;
  return {
    id: { kind: "remoteEventId", value: `id-${draft.uid}` },
    deleteHandle: { kind: "deleteHandle", value: `id-${draft.uid}` },
    uid: { kind: "eventUid", value: draft.uid },
    calendar: draft.calendar ?? microsoftCalendar,
    revision,
    version: { kind: "remoteVersion", value: `ck-${revision}-id-${draft.uid}` },
    content: {
      title: draft.title ?? draft.uid,
      description: draft.description ?? null,
      location: draft.location ?? null,
      availability: "busy",
      visibility: "default",
      recurrence: null,
      time: {
        kind: "timed",
        start: { kind: "instant", value: draft.start },
        end: { kind: "instant", value: draft.end },
        zone: { kind: "zoneId", value: "UTC" },
      },
    },
    fingerprint: { kind: "fingerprint", value: `fp-${draft.uid}-${revision}` },
    provenance: { kind: "foreign" },
  };
};

const manyForeignEvents = (count: number): readonly RemoteEvent[] => {
  const events: RemoteEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    const hour = `${index % 24}`.padStart(2, "0");
    const day = `${(index % 28) + 1}`.padStart(2, "0");
    events.push(
      foreignEvent({
        uid: `seed-${index}`,
        start: `2026-03-${day}T${hour}:00:00.000Z`,
        end: `2026-03-${day}T${hour}:30:00.000Z`,
      }),
    );
  }
  return events;
};

interface SeedOptions {
  readonly cancelled?: readonly string[];
  readonly corruptKnownRows?: readonly string[];
  readonly unattributableRemovals?: readonly string[];
}

const seedOf = (events: readonly RemoteEvent[], options: SeedOptions = {}): ProviderSeed => ({
  events,
  corruptKnownRows: options.corruptKnownRows ?? [],
  cancelled: (options.cancelled ?? []).map((uid) => ({ kind: "eventUid", value: uid })),
  unattributableRemovals: (options.unattributableRemovals ?? []).map((id) => ({
    kind: "remoteEventId",
    value: id,
  })),
});

export {
  allDayItem,
  foreignEvent,
  manyForeignEvents,
  occurrenceItem,
  ourItem,
  removedItem,
  seedOf,
  seriesMasterItem,
  timedItem,
};
export type { ForeignDraft, SeedOptions, TimedDraft };
