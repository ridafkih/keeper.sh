import type {
  CalendarKey,
  DescribedContent,
  EditableContent,
  EventTime,
  ForeignEvent,
  IndeterminateEvent,
  InstallationId,
  Instant,
  ListingScope,
  NormalizedContent,
  OperationContext,
  OwnEvent,
  RemoteEvent,
  RemoteEventFacts,
  SingleOccurrenceContent,
  TimeWindow,
  WindowMembership,
  WritableCalendar,
  WriteIntent,
} from "@keeper.sh/sync-protocol";
import type { CanonicalValue } from "../../src/canonical";
import type { ProviderSeed } from "../../src/options";
import type { KnownMirror } from "../../src/assertions/no-removal";
import { referenceCalendar } from "../../src/reference/provider";

const instant = (value: string): Instant => ({ kind: "instant", value });

const installation: InstallationId = { kind: "installationId", value: "keeper-conformance" };

const foreignInstallation: InstallationId = { kind: "installationId", value: "someone-else" };

const spanning = (start: string, end: string): TimeWindow => ({
  start: instant(start),
  end: instant(end),
});

const timedAt = (start: string, end: string): EventTime => ({
  kind: "timed",
  start: instant(start),
  end: instant(end),
  zone: { kind: "zoneId", value: "UTC" },
});

const describedAs = (title: string): DescribedContent => ({
  title,
  description: null,
  location: null,
  availability: "busy",
  visibility: "default",
});

const occurrence = (title: string, time: EventTime): SingleOccurrenceContent => ({
  ...describedAs(title),
  recurrence: null,
  time,
});

interface EventDraft {
  readonly uid: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly revision?: number;
  readonly calendar?: CalendarKey;
}

const factsOf = (draft: EventDraft): RemoteEventFacts => ({
  id: { kind: "remoteEventId", value: `id-${draft.uid}` },
  deleteHandle: { kind: "deleteHandle", value: `handle-${draft.uid}` },
  uid: { kind: "eventUid", value: draft.uid },
  calendar: draft.calendar ?? referenceCalendar,
  revision: draft.revision ?? 1,
  version: { kind: "remoteVersion", value: `v${draft.revision ?? 1}-${draft.uid}` },
  content: occurrence(draft.title, timedAt(draft.start, draft.end)),
  fingerprint: { kind: "fingerprint", value: `fp-${draft.uid}-${draft.revision ?? 1}` },
});

const foreignEvent = (draft: EventDraft): ForeignEvent => ({
  ...factsOf(draft),
  provenance: { kind: "foreign" },
});

const ownEvent = (draft: EventDraft): OwnEvent => ({
  ...factsOf(draft),
  provenance: { kind: "ours", installation },
});

const indeterminateEvent = (draft: EventDraft): IndeterminateEvent => ({
  ...factsOf(draft),
  provenance: { kind: "indeterminate" },
});

const writableCalendar: WritableCalendar = {
  key: referenceCalendar,
  access: "readWrite",
};

const scopeOver = (covered: TimeWindow): ListingScope => ({
  calendar: referenceCalendar,
  window: covered,
  expandRecurrences: true,
});

interface ContextDraft {
  readonly now: () => Instant;
  readonly signal: AbortSignal;
  readonly deadlineMs?: number;
  readonly maxAttempts?: number;
  readonly retryDelayCeilingMs?: number;
}

const contextOf = (draft: ContextDraft): OperationContext => ({
  signal: draft.signal,
  now: draft.now,
  deadline: instant(
    new Date(Date.parse(draft.now().value) + (draft.deadlineMs ?? 30_000)).toISOString(),
  ),
  retryBudget: {
    maxAttempts: draft.maxAttempts ?? 4,
    retryDelayCeilingMs: draft.retryDelayCeilingMs ?? 1000,
  },
});

const isInsideWindow: WindowMembership = (bounds, time) => {
  if (time.kind === "allDay") {
    return time.startDate.value >= bounds.start.value && time.startDate.value < bounds.end.value;
  }
  return time.start.value < bounds.end.value && time.end.value > bounds.start.value;
};

const timeOf = (event: RemoteEvent): EventTime => {
  const { time } = event.content;
  if (!time) {
    throw new Error(`expected a single-occurrence event, "${event.uid.value}" is recurring`);
  }
  return time;
};

const summarise = (events: readonly RemoteEvent[]): CanonicalValue =>
  events.map((event) => ({
    uid: event.uid.value,
    revision: event.revision,
    title: event.content.title,
    provenance: event.provenance.kind,
  }));

const normalized = (
  content: EditableContent,
  fingerprint: string,
): NormalizedContent<"reference"> => ({
  kind: "normalized",
  provider: "reference",
  content,
  fingerprint: { kind: "fingerprint", value: fingerprint },
});

const createIntent = (
  key: string,
  content: EditableContent,
): WriteIntent<"reference"> => ({
  kind: "create",
  calendar: writableCalendar,
  idempotencyKey: { kind: "idempotencyKey", value: key },
  content: normalized(content, `fp-${key}`),
  provenance: { kind: "ours", installation },
  precondition: { kind: "absent" },
});

const updateIntent = (
  target: string,
  content: EditableContent,
  version: string,
): WriteIntent<"reference"> => ({
  kind: "update",
  calendar: writableCalendar,
  target: { kind: "remoteEventId", value: target },
  content: normalized(content, `fp-${target}`),
  precondition: { kind: "matchesVersion", version: { kind: "remoteVersion", value: version } },
});

const deleteIntent = (handle: string, version: string): WriteIntent<"reference"> => ({
  kind: "delete",
  calendar: writableCalendar,
  target: { kind: "deleteHandle", value: handle },
  precondition: { kind: "matchesVersion", version: { kind: "remoteVersion", value: version } },
  reason: "sourceDeleted",
});

const knownFrom = (events: readonly RemoteEvent[]): KnownMirror => ({
  calendar: referenceCalendar,
  entries: events.map((event) => ({ uid: event.uid.value, id: event.id, time: timeOf(event) })),
});

const knownNamed = (uid: string, time: EventTime): KnownMirror => ({
  calendar: referenceCalendar,
  entries: [{ uid, id: { kind: "remoteEventId", value: `id-${uid}` }, time }],
});

const seedOf = (
  events: readonly RemoteEvent[],
  corruptKnownRows: readonly string[] = [],
): ProviderSeed => ({
  events,
  corruptKnownRows,
  cancelled: [],
  unattributableRemovals: [],
});

export {
  contextOf,
  createIntent,
  knownFrom,
  knownNamed,
  seedOf,
  deleteIntent,
  normalized,
  updateIntent,
  describedAs,
  foreignEvent,
  foreignInstallation,
  indeterminateEvent,
  installation,
  instant,
  isInsideWindow,
  occurrence,
  ownEvent,
  scopeOver,
  summarise,
  timeOf,
  timedAt,
  spanning,
  writableCalendar,
};
export type { ContextDraft, EventDraft };
