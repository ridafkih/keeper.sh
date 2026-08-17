import type {
  EditableContent,
  NormalizedContent,
  RemoteVersion,
  WriteIntent,
} from "@keeper.sh/sync-protocol";
import { caldavWritableCalendar } from "./harness";

interface ContentDraft {
  readonly title?: string;
  readonly description?: string | null;
  readonly location?: string | null;
  readonly start?: string;
  readonly end?: string;
  readonly zone?: string;
}

const timedContent = (draft: ContentDraft = {}): EditableContent => ({
  title: draft.title ?? "Mirrored event",
  description: draft.description ?? null,
  location: draft.location ?? null,
  availability: "busy",
  visibility: "default",
  recurrence: null,
  time: {
    kind: "timed",
    start: { kind: "instant", value: draft.start ?? "2026-03-21T09:00:00.000Z" },
    end: { kind: "instant", value: draft.end ?? "2026-03-21T10:00:00.000Z" },
    zone: { kind: "zoneId", value: draft.zone ?? "UTC" },
  },
});

const allDayContent = (startDate: string, endDateExclusive: string): EditableContent => ({
  title: "Mirrored all-day event",
  description: null,
  location: null,
  availability: "busy",
  visibility: "default",
  recurrence: null,
  time: {
    kind: "allDay",
    startDate: { kind: "calendarDate", value: startDate },
    endDateExclusive: { kind: "calendarDate", value: endDateExclusive },
  },
});

const recurringContent = (rule: string, exceptions: readonly string[] = []): EditableContent => ({
  title: "Mirrored series",
  description: null,
  location: null,
  availability: "busy",
  visibility: "default",
  recurrence: { dialect: "rfc5545", value: rule, exceptions },
  anchor: {
    kind: "timed",
    start: { kind: "instant", value: "2026-03-02T09:00:00.000Z" },
    zone: { kind: "zoneId", value: "Europe/Berlin" },
    duration: { kind: "exact", seconds: 3600 },
  },
});

const normalizedOf = (content: EditableContent): NormalizedContent<"caldav"> => ({
  kind: "normalized",
  provider: "caldav",
  content,
  fingerprint: { kind: "fingerprint", value: `fp-${content.title}` },
});

const createIntent = (
  idempotencyKey: string,
  content: NormalizedContent<"caldav">,
  installation: string,
): Extract<WriteIntent<"caldav">, { kind: "create" }> => ({
  kind: "create",
  calendar: caldavWritableCalendar,
  idempotencyKey: { kind: "idempotencyKey", value: idempotencyKey },
  content,
  provenance: { kind: "ours", installation: { kind: "installationId", value: installation } },
  precondition: { kind: "absent" },
});

const updateIntent = (
  target: string,
  content: NormalizedContent<"caldav">,
  version: RemoteVersion,
): Extract<WriteIntent<"caldav">, { kind: "update" }> => ({
  kind: "update",
  calendar: caldavWritableCalendar,
  target: { kind: "remoteEventId", value: target },
  content,
  precondition: { kind: "matchesVersion", version },
});

const deleteIntent = (
  target: string,
  version: RemoteVersion,
): Extract<WriteIntent<"caldav">, { kind: "delete" }> => ({
  kind: "delete",
  calendar: caldavWritableCalendar,
  target: { kind: "deleteHandle", value: target },
  precondition: { kind: "matchesVersion", version },
  reason: "sourceDeleted",
});

const retireIntent = (
  target: string,
  version: RemoteVersion,
): Extract<WriteIntent<"caldav">, { kind: "retire" }> => ({
  kind: "retire",
  calendar: caldavWritableCalendar,
  target: { kind: "deleteHandle", value: target },
  precondition: { kind: "matchesVersion", version },
  reason: "outsideWindow",
});

const versionOf = (value: string): RemoteVersion => ({ kind: "remoteVersion", value });

export {
  allDayContent,
  createIntent,
  deleteIntent,
  normalizedOf,
  recurringContent,
  retireIntent,
  timedContent,
  updateIntent,
  versionOf,
};
export type { ContentDraft };
