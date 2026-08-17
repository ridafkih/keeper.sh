import type { calendar_v3 } from "@googleapis/calendar";
import type { ProviderSeed } from "@keeper.sh/sync-conformance";
import type { CalendarKey, RemoteEvent } from "@keeper.sh/sync-protocol";
import { googleCalendar } from "./harness";

interface TimedDraft {
  readonly id: string;
  readonly uid?: string;
  readonly start: string;
  readonly end: string;
  readonly summary?: string;
  readonly description?: string;
  readonly location?: string;
  readonly updated?: string;
  readonly etag?: string;
  readonly timeZone?: string;
  readonly eventType?: string;
}

const timedItem = (draft: TimedDraft): calendar_v3.Schema$Event => ({
  id: draft.id,
  iCalUID: draft.uid ?? `${draft.id}@google.com`,
  etag: draft.etag ?? `"v1-${draft.id}"`,
  status: "confirmed",
  summary: draft.summary ?? draft.id,
  description: draft.description ?? null,
  location: draft.location ?? null,
  updated: draft.updated ?? "2026-03-11T00:00:00.000Z",
  eventType: draft.eventType ?? "default",
  start: { dateTime: draft.start, timeZone: draft.timeZone ?? "UTC" },
  end: { dateTime: draft.end, timeZone: draft.timeZone ?? "UTC" },
});

interface AllDayDraft {
  readonly id: string;
  readonly uid?: string;
  readonly startDate: string;
  readonly endDateExclusive: string;
  readonly summary?: string;
}

const allDayItem = (draft: AllDayDraft): calendar_v3.Schema$Event => ({
  id: draft.id,
  iCalUID: draft.uid ?? `${draft.id}@google.com`,
  etag: `"v1-${draft.id}"`,
  status: "confirmed",
  summary: draft.summary ?? draft.id,
  updated: "2026-03-11T00:00:00.000Z",
  eventType: "default",
  start: { date: draft.startDate },
  end: { date: draft.endDateExclusive },
});

const cancelledException = (
  id: string,
  recurringEventId: string,
  originalStart: string,
): calendar_v3.Schema$Event => ({
  id,
  status: "cancelled",
  recurringEventId,
  originalStartTime: { dateTime: originalStart, timeZone: "UTC" },
});

const cancelledWithoutIdentity = (): calendar_v3.Schema$Event => ({ status: "cancelled" });

const seriesMaster = (id: string, rule: string, start: string): calendar_v3.Schema$Event => ({
  id,
  iCalUID: `${id}@google.com`,
  etag: `"v1-${id}"`,
  status: "confirmed",
  summary: id,
  updated: "2026-03-11T00:00:00.000Z",
  eventType: "default",
  recurrence: [rule],
  start: { dateTime: start, timeZone: "UTC" },
  end: { dateTime: start, timeZone: "UTC" },
});

interface ForeignDraft {
  readonly uid: string;
  readonly start: string;
  readonly end: string;
  readonly revision?: number;
  readonly calendar?: CalendarKey;
}

const foreignEvent = (draft: ForeignDraft): RemoteEvent => {
  const revision = draft.revision ?? 1;
  return {
    id: { kind: "remoteEventId", value: `id-${draft.uid}` },
    deleteHandle: { kind: "deleteHandle", value: `id-${draft.uid}` },
    uid: { kind: "eventUid", value: draft.uid },
    calendar: draft.calendar ?? googleCalendar,
    revision,
    version: { kind: "remoteVersion", value: `v${revision}-${draft.uid}` },
    content: {
      title: draft.uid,
      description: null,
      location: null,
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

const hundredForeignEvents = (): readonly RemoteEvent[] => {
  const events: RemoteEvent[] = [];
  for (let index = 0; index < 100; index += 1) {
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
  cancelledException,
  cancelledWithoutIdentity,
  foreignEvent,
  hundredForeignEvents,
  seedOf,
  seriesMaster,
  timedItem,
};
export type { AllDayDraft, ForeignDraft, SeedOptions, TimedDraft };
