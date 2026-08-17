import type {
  EditableContent,
  NormalizedContent,
  RemoteVersion,
  WriteIntent,
} from "@keeper.sh/sync-protocol";
import { googleWritableCalendar } from "./harness";

interface ContentDraft {
  readonly title?: string;
  readonly description?: string | null;
  readonly location?: string | null;
  readonly start?: string;
  readonly end?: string;
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
    zone: { kind: "zoneId", value: "UTC" },
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

const normalizedOf = (content: EditableContent): NormalizedContent<"google"> => ({
  kind: "normalized",
  provider: "google",
  content,
  fingerprint: { kind: "fingerprint", value: `fp-${content.title}` },
});

const createIntent = (
  idempotencyKey: string,
  content: NormalizedContent<"google">,
  installation: string,
): Extract<WriteIntent<"google">, { kind: "create" }> => ({
  kind: "create",
  calendar: googleWritableCalendar,
  idempotencyKey: { kind: "idempotencyKey", value: idempotencyKey },
  content,
  provenance: { kind: "ours", installation: { kind: "installationId", value: installation } },
  precondition: { kind: "absent" },
});

const updateIntent = (
  target: string,
  content: NormalizedContent<"google">,
  version: RemoteVersion,
): Extract<WriteIntent<"google">, { kind: "update" }> => ({
  kind: "update",
  calendar: googleWritableCalendar,
  target: { kind: "remoteEventId", value: target },
  content,
  precondition: { kind: "matchesVersion", version },
});

const deleteIntent = (
  target: string,
  version: RemoteVersion,
): Extract<WriteIntent<"google">, { kind: "delete" }> => ({
  kind: "delete",
  calendar: googleWritableCalendar,
  target: { kind: "deleteHandle", value: target },
  precondition: { kind: "matchesVersion", version },
  reason: "sourceDeleted",
});

const versionOf = (value: string): RemoteVersion => ({ kind: "remoteVersion", value });

export {
  allDayContent,
  createIntent,
  deleteIntent,
  normalizedOf,
  timedContent,
  updateIntent,
  versionOf,
};
export type { ContentDraft };
