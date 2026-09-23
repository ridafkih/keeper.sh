import type {
  Availability,
  CalendarKey,
  Capabilities,
  ChangeListing,
  DeleteHandle,
  EditableContent,
  EventTime,
  EventUid,
  Fingerprint,
  InstallationId,
  Instant,
  ListingDiagnostics,
  ListingScope,
  RemoteEvent,
  RemoteEventId,
  RemoteRef,
  RemoteVersion,
  Removal,
  SyncCursor,
  TimeWindow,
  WithheldEvent,
  WritableCalendar,
} from "@keeper.sh/sync-protocol";
import { defaultPlanLimits, defaultWindowMembership } from "../../src/index";
import type {
  KnownEvent,
  KnownState,
  Mapping,
  MappingSet,
  MirrorFingerprint,
  ObservedState,
  ProvenCoverage,
  ReconciliationPolicy,
  SourceFingerprint,
  SourceIdentity,
} from "../../src/index";
import { expectedCalendarKeyString } from "./keys";

const instant = (value: string): Instant => ({ kind: "instant", value });
const uid = (value: string): EventUid => ({ kind: "eventUid", value });
const remoteId = (value: string): RemoteEventId => ({ kind: "remoteEventId", value });
const deleteHandle = (value: string): DeleteHandle => ({ kind: "deleteHandle", value });
const version = (value: string): RemoteVersion => ({ kind: "remoteVersion", value });
const fingerprint = (value: string): Fingerprint => ({ kind: "fingerprint", value });
const installation = (value: string): InstallationId => ({ kind: "installationId", value });

const sourcePrint = (value: string): SourceFingerprint => ({
  kind: "sourceFingerprint",
  value: fingerprint(value),
});

const mirrorPrint = (value: string): MirrorFingerprint => ({
  kind: "mirrorFingerprint",
  value: fingerprint(value),
});

const sourceCalendar: CalendarKey = {
  provider: "google",
  account: { kind: "accountId", value: "acct-source" },
  calendar: { kind: "calendarId", value: "cal-source" },
};

const destinationCalendar: CalendarKey = {
  provider: "microsoft",
  account: { kind: "accountId", value: "acct-destination" },
  calendar: { kind: "calendarId", value: "cal-destination" },
};

const writableDestination: WritableCalendar = {
  key: destinationCalendar,
  access: "readWrite",
};

const ourInstallation = installation("install-ours");
const foreignInstallation = installation("install-theirs");

const mirrorWindow: TimeWindow = {
  start: instant("2026-01-01T00:00:00.000Z"),
  end: instant("2026-12-31T00:00:00.000Z"),
};

const provenWindows: Extract<ProvenCoverage, { kind: "proven" }> = {
  kind: "proven",
  calendar: sourceCalendar,
  historic: { start: instant("2026-01-01T00:00:00.000Z"), end: instant("2026-06-01T00:00:00.000Z") },
  future: { start: instant("2026-06-01T00:00:00.000Z"), end: instant("2026-12-31T00:00:00.000Z") },
};

const sourceScope: ListingScope = {
  calendar: sourceCalendar,
  window: mirrorWindow,
  expandRecurrences: false,
};

const destinationScope: ListingScope = {
  calendar: destinationCalendar,
  window: mirrorWindow,
  expandRecurrences: false,
};

const emptyDiagnostics: ListingDiagnostics = {
  withheld: { sample: [], total: 0 },
  selfAuthored: { sample: [], total: 0 },
  unrepresentable: { sample: [], total: 0 },
  pagesFetched: 1,
};

const masterIdentity = (value: string): SourceIdentity => ({ kind: "master", uid: uid(value) });

const overrideIdentity = (value: string, recurrence: string): SourceIdentity => ({
  kind: "override",
  uid: uid(value),
  recurrenceInstant: instant(recurrence),
});

const slotIdentity = (value: string, start: string, end: string): SourceIdentity => ({
  kind: "slot",
  uid: uid(value),
  start: instant(start),
  end: instant(end),
});

const timedAt = (start: string, end: string): EventTime => ({
  kind: "timed",
  start: instant(start),
  end: instant(end),
  zone: null,
});

const allDayOn = (startDate: string, endDateExclusive: string): EventTime => ({
  kind: "allDay",
  startDate: { kind: "calendarDate", value: startDate },
  endDateExclusive: { kind: "calendarDate", value: endDateExclusive },
});

const defaultEventTime = timedAt("2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const describedContent = (
  title: string,
  availability: Availability,
  time: EventTime,
): EditableContent => ({
  title,
  description: null,
  location: null,
  availability,
  visibility: "default",
  recurrence: null,
  time,
});

interface EventSpec {
  readonly id: string;
  readonly uid: string;
  readonly title?: string;
  readonly time?: EventTime;
  readonly availability?: Availability;
  readonly revision?: number;
  readonly version?: string;
  readonly fingerprint?: string;
  readonly deleteHandle?: string;
  readonly calendar?: CalendarKey;
  readonly content?: EditableContent;
}

const contentFor = (spec: EventSpec): EditableContent => {
  if (spec.content) {
    return spec.content;
  }
  return describedContent(
    spec.title ?? spec.id,
    spec.availability ?? "busy",
    spec.time ?? defaultEventTime,
  );
};

const foreignEvent = (spec: EventSpec): RemoteEvent => ({
  id: remoteId(spec.id),
  deleteHandle: deleteHandle(spec.deleteHandle ?? spec.id),
  uid: uid(spec.uid),
  calendar: spec.calendar ?? sourceCalendar,
  revision: spec.revision ?? 1,
  version: version(spec.version ?? `v-${spec.id}-1`),
  content: contentFor(spec),
  fingerprint: fingerprint(spec.fingerprint ?? `fp-${spec.id}`),
  provenance: { kind: "foreign" },
});

const recurringContent = (title: string, anchorStart: string, rule: string): EditableContent => ({
  title,
  description: null,
  location: null,
  availability: "busy",
  visibility: "default",
  recurrence: { dialect: "rfc5545", value: rule, exceptions: [] },
  anchor: {
    kind: "timed",
    start: instant(anchorStart),
    zone: { kind: "zoneId", value: "UTC" },
    duration: { kind: "exact", seconds: 3600 },
  },
});

const recurringEvent = (spec: EventSpec, anchorStart: string, rule: string): RemoteEvent => ({
  ...foreignEvent(spec),
  content: recurringContent(spec.title ?? spec.id, anchorStart, rule),
});

const ownedEvent = (spec: EventSpec, by: InstallationId): RemoteEvent => ({
  ...foreignEvent(spec),
  provenance: { kind: "ours", installation: by },
});

const indeterminateEvent = (spec: EventSpec): RemoteEvent => ({
  ...foreignEvent(spec),
  provenance: { kind: "indeterminate" },
});

const cursorFor = (value: string, scope: ListingScope): SyncCursor => ({
  kind: "syncCursor",
  value,
  scope,
});

interface ListingSpec {
  readonly events?: readonly RemoteEvent[];
  readonly removals?: readonly Removal[];
  readonly withheld?: readonly WithheldEvent[];
  readonly cursor?: SyncCursor | null;
  readonly scope?: ListingScope;
  readonly covered?: TimeWindow;
  readonly diagnostics?: ListingDiagnostics;
}

const snapshotListing = (spec: ListingSpec): ChangeListing => {
  const scope = spec.scope ?? sourceScope;
  return {
    kind: "snapshot",
    scope,
    coverage: { covered: spec.covered ?? scope.window, calendar: scope.calendar },
    events: spec.events ?? [],
    removals: spec.removals ?? [],
    withheld: spec.withheld ?? [],
    cursor: spec.cursor ?? null,
    diagnostics: spec.diagnostics ?? emptyDiagnostics,
  };
};

const deltaListing = (spec: ListingSpec): ChangeListing => {
  const scope = spec.scope ?? sourceScope;
  return {
    kind: "delta",
    scope,
    coverage: { covered: spec.covered ?? scope.window, calendar: scope.calendar },
    events: spec.events ?? [],
    removals: spec.removals ?? [],
    withheld: spec.withheld ?? [],
    cursor: spec.cursor ?? cursorFor("cursor-next", scope),
    diagnostics: spec.diagnostics ?? emptyDiagnostics,
  };
};

const partialListing = (spec: ListingSpec): ChangeListing => {
  const scope = spec.scope ?? sourceScope;
  return {
    kind: "partial",
    scope,
    events: spec.events ?? [],
    withheld: spec.withheld ?? [],
    continuation: { kind: "continuation", value: "page-2", scope },
    diagnostics: spec.diagnostics ?? emptyDiagnostics,
  };
};

const cursorLostListing = (spec: ListingSpec): ChangeListing => ({
  kind: "cursorLost",
  scope: spec.scope ?? sourceScope,
  diagnostics: spec.diagnostics ?? emptyDiagnostics,
});

const sourceOnly = (source: ChangeListing): ObservedState => ({ kind: "sourceOnly", source });

const bothSides = (source: ChangeListing, destination: ChangeListing): ObservedState => ({
  kind: "bothSides",
  source,
  destination,
});

interface KnownSpec {
  readonly identity: SourceIdentity;
  readonly remoteId?: string;
  readonly fingerprint?: string;
  readonly revision?: number;
  readonly time?: EventTime;
  readonly recurring?: boolean;
  readonly calendar?: CalendarKey;
}

const knownEvent = (spec: KnownSpec): KnownEvent => ({
  identity: spec.identity,
  remoteId: remoteId(spec.remoteId ?? spec.identity.uid.value),
  sourceFingerprint: sourcePrint(spec.fingerprint ?? `fp-${spec.identity.uid.value}`),
  revision: spec.revision ?? 0,
  time: spec.time ?? timedAt("2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
  recurring: spec.recurring ?? false,
  sourceCalendar: spec.calendar ?? sourceCalendar,
});

const knownState = (events: readonly KnownEvent[], corrupt: KnownState["corrupt"] = []): KnownState => ({
  calendar: sourceCalendar,
  events,
  corrupt,
});

interface MappingSpec {
  readonly identity: SourceIdentity;
  readonly destinationId: string;
  readonly destinationHandle?: string;
  readonly sourceFingerprint?: string;
  readonly mirrorFingerprint?: string;
  readonly version?: string;
}

const remoteRef = (id: string, handle: string): RemoteRef => ({
  id: remoteId(id),
  deleteHandle: deleteHandle(handle),
});

const mapping = (spec: MappingSpec): Mapping => ({
  sourceIdentity: spec.identity,
  sourceCalendar,
  destination: remoteRef(spec.destinationId, spec.destinationHandle ?? spec.destinationId),
  destinationCalendar,
  sourceFingerprint: sourcePrint(spec.sourceFingerprint ?? `fp-${spec.identity.uid.value}`),
  mirrorFingerprint: mirrorPrint(spec.mirrorFingerprint ?? `mirror-${spec.identity.uid.value}`),
  precondition: { kind: "matchesVersion", version: version(spec.version ?? `v-${spec.destinationId}-1`) },
});

const mappingSet = (entries: readonly Mapping[]): MappingSet => ({ entries });

const capabilities: Capabilities = {
  provider: "microsoft",
  delta: { kind: "tokenized", windowBoundToCursor: true },
  deletionAuthority: "snapshotAbsence",
  removalsAreAmbiguous: false,
  precondition: "matchesVersion",
  provenanceChannel: "extendedProperty",
  quotaScope: "perUser",
  throttleSignals: [{ status: 429, hasRetryAfter: true }],
  representableRange: {
    minimumSpanSeconds: 0,
    zeroDuration: "accept",
    invertedRange: "clampToStart",
    allDayGrid: "utcDay",
  },
  allDay: "dateOnly",
  recurrenceWrite: "rfc5545",
  echoesWrites: true,
};

interface PolicySpec {
  readonly coverage?: ProvenCoverage;
  readonly mirrorWindow?: TimeWindow;
  readonly limits?: ReconciliationPolicy["limits"];
  readonly capabilities?: Capabilities;
  readonly installation?: InstallationId;
  readonly withinWindow?: ReconciliationPolicy["withinWindow"];
  readonly destination?: WritableCalendar;
}

const policy = (spec: PolicySpec = {}): ReconciliationPolicy => ({
  installation: spec.installation ?? ourInstallation,
  destination: spec.destination ?? writableDestination,
  capabilities: spec.capabilities ?? capabilities,
  mirrorWindow: spec.mirrorWindow ?? mirrorWindow,
  coverageBySource: new Map([
    [expectedCalendarKeyString(sourceCalendar), spec.coverage ?? provenWindows],
  ]),
  withinWindow: spec.withinWindow ?? defaultWindowMembership,
  limits: spec.limits ?? defaultPlanLimits,
});

const unprovenPolicy = (): ReconciliationPolicy => policy({ coverage: { kind: "unproven" } });

export {
  allDayOn,
  bothSides,
  capabilities,
  cursorFor,
  cursorLostListing,
  deleteHandle,
  deltaListing,
  describedContent,
  destinationCalendar,
  destinationScope,
  emptyDiagnostics,
  fingerprint,
  foreignEvent,
  foreignInstallation,
  indeterminateEvent,
  installation,
  instant,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  masterIdentity,
  mirrorPrint,
  mirrorWindow,
  ourInstallation,
  overrideIdentity,
  ownedEvent,
  partialListing,
  policy,
  provenWindows,
  recurringContent,
  recurringEvent,
  remoteId,
  remoteRef,
  slotIdentity,
  snapshotListing,
  sourceCalendar,
  sourceOnly,
  sourcePrint,
  sourceScope,
  timedAt,
  uid,
  unprovenPolicy,
  version,
  writableDestination,
};
export type { EventSpec, KnownSpec, ListingSpec, MappingSpec, PolicySpec };
