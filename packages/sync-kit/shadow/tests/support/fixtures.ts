import type {
  CalendarKey,
  Capabilities,
  ChangeListing,
  EventTime,
  ListingDiagnostics,
  ListingScope,
  InstallationId,
  Instant,
  ObservedPrecondition,
  Provenance,
  RemoteEvent,
  RemoteRef,
  Removal,
  TimeWindow,
  WithheldEvent,
  WritableCalendar,
} from "@keeper.sh/sync-protocol";
import { withinTimeWindow } from "@keeper.sh/sync-ical";
import { defaultPlanLimits, mirrorFingerprintOf, sourceFingerprintOf } from "@keeper.sh/sync-reconcile";
import type { SourceIdentity } from "@keeper.sh/sync-reconcile";
import type {
  DestinationNormalizationWitness,
  DestinationSyncInput,
  LocalReadCompleteness,
  MirrorRow,
  ShadowOptions,
  SourceReadWitness,
  StoredSourceCoverage,
  StoredSourceEvent,
  WithheldSourceEvent,
  WithholdingCounter,
} from "../../src/index";
import { defaultShadowLimits, planUnitWithReconciliation } from "../../src/index";
import {
  accountId,
  calendarDate,
  calendarId,
  deleteHandle,
  fingerprint,
  installation,
  instant,
  remoteId,
  uid,
  version,
  zone,
} from "./handles";

const sourceCalendarA: CalendarKey = {
  provider: "google",
  account: accountId("acct-source-a"),
  calendar: calendarId("cal-source-a"),
};

const sourceCalendarB: CalendarKey = {
  provider: "google",
  account: accountId("acct-source-b"),
  calendar: calendarId("cal-source-b"),
};

const destinationCalendar: CalendarKey = {
  provider: "microsoft",
  account: accountId("acct-destination"),
  calendar: calendarId("cal-destination"),
};

const otherCalendar: CalendarKey = {
  provider: "microsoft",
  account: accountId("acct-elsewhere"),
  calendar: calendarId("cal-elsewhere"),
};

const writableDestination: WritableCalendar = { key: destinationCalendar, access: "readWrite" };

const ourInstallation = installation("install-ours");
const foreignInstallation = installation("install-theirs");

const mirrorWindow: TimeWindow = {
  start: instant("2026-01-01T00:00:00.000Z"),
  end: instant("2026-12-31T00:00:00.000Z"),
};

const historicRange: TimeWindow = {
  start: instant("2026-01-01T00:00:00.000Z"),
  end: instant("2026-06-01T00:00:00.000Z"),
};

const futureRange: TimeWindow = {
  start: instant("2026-06-01T00:00:00.000Z"),
  end: instant("2026-12-31T00:00:00.000Z"),
};

const asOf = instant("2026-06-15T12:00:00.000Z");
const recordedRecently = instant("2026-06-15T11:30:00.000Z");

const emptyDiagnostics: ListingDiagnostics = {
  withheld: { sample: [], total: 0 },
  selfAuthored: { sample: [], total: 0 },
  unrepresentable: { sample: [], total: 0 },
  pagesFetched: 1,
};

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

const masterIdentity = (value: string): SourceIdentity => ({ kind: "master", uid: uid(value) });

const slotIdentity = (value: string, start: string, end: string): SourceIdentity => ({
  kind: "slot",
  uid: uid(value),
  start: instant(start),
  end: instant(end),
});

const overrideIdentity = (value: string, recurrence: string): SourceIdentity => ({
  kind: "override",
  uid: uid(value),
  recurrenceInstant: instant(recurrence),
});

const timedAt = (start: string, end: string): EventTime => ({
  kind: "timed",
  start: instant(start),
  end: instant(end),
  zone: null,
});

const allDayOn = (start: string, endExclusive: string): EventTime => ({
  kind: "allDay",
  startDate: calendarDate(start),
  endDateExclusive: calendarDate(endExclusive),
});

const inHistoric = timedAt("2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const inFuture = timedAt("2026-09-10T09:00:00.000Z", "2026-09-10T10:00:00.000Z");

interface CanonicalContentSpec {
  readonly title?: string;
  readonly description?: string | null;
  readonly location?: string | null;
}

const canonicalPayload = (
  identity: SourceIdentity,
  time: EventTime,
  content: CanonicalContentSpec = {},
): unknown => ({
  identity,
  content: {
    title: content.title ?? `title-${identity.uid.value}`,
    description: content.description ?? null,
    location: content.location ?? null,
    availability: "busy",
    visibility: "default",
    recurrence: null,
    time,
  },
  cancellations: [],
});

const recurringCanonicalPayload = (identity: SourceIdentity, anchorStart: string): unknown => ({
  identity,
  content: {
    title: `title-${identity.uid.value}`,
    description: null,
    location: null,
    availability: "busy",
    visibility: "default",
    recurrence: { dialect: "rfc5545", value: "FREQ=WEEKLY", exceptions: [] },
    anchor: {
      kind: "timed",
      start: instant(anchorStart),
      zone: zone("UTC"),
      duration: { kind: "exact", seconds: 3600 },
    },
  },
  cancellations: [],
});

interface StoredEventSpec {
  readonly identity: SourceIdentity;
  readonly provenance?: Provenance;
  readonly sourceCalendar?: CalendarKey;
  readonly id?: string;
  readonly deleteHandle?: string;
  readonly revision?: number;
  readonly version?: string;
  readonly fingerprint?: string;
  readonly time?: EventTime;
  readonly recurring?: boolean;
  readonly canonical?: unknown;
  readonly content?: CanonicalContentSpec;
}

const storedCanonicalOf = (spec: StoredEventSpec, time: EventTime): unknown => {
  if (Object.hasOwn(spec, "canonical")) {
    return spec.canonical;
  }
  return canonicalPayload(spec.identity, time, spec.content ?? {});
};

const storedSourceEvent = (spec: StoredEventSpec): StoredSourceEvent => {
  const id = spec.id ?? spec.identity.uid.value;
  const time = spec.time ?? inHistoric;
  return {
    sourceCalendar: spec.sourceCalendar ?? sourceCalendarA,
    id: remoteId(id),
    deleteHandle: deleteHandle(spec.deleteHandle ?? id),
    uid: spec.identity.uid,
    revision: spec.revision ?? 1,
    version: version(spec.version ?? `v-${id}-1`),
    fingerprint: fingerprint(spec.fingerprint ?? `fp-${id}`),
    provenance: spec.provenance ?? { kind: "foreign" },
    canonical: storedCanonicalOf(spec, time),
    time,
    recurring: spec.recurring ?? false,
  };
};

interface MirrorSpec {
  readonly identity: SourceIdentity;
  readonly sourceCalendar?: CalendarKey;
  readonly sourceRemoteId?: string;
  readonly sourceFingerprint?: string;
  readonly sourceRevision?: number;
  readonly time?: EventTime;
  readonly recurring?: boolean;
  readonly destinationId?: string;
  readonly destinationHandle?: string;
  readonly destinationCalendar?: CalendarKey;
  readonly mirrorFingerprint?: string;
  readonly precondition?: ObservedPrecondition;
}

const remoteRef = (id: string, handle: string): RemoteRef => ({
  id: remoteId(id),
  deleteHandle: deleteHandle(handle),
});

const mirrorRow = (spec: MirrorSpec): MirrorRow => {
  const key = spec.identity.uid.value;
  const destinationId = spec.destinationId ?? `mirror-${key}`;
  return {
    sourceCalendar: spec.sourceCalendar ?? sourceCalendarA,
    sourceIdentity: spec.identity,
    sourceRemoteId: remoteId(spec.sourceRemoteId ?? key),
    sourceFingerprint: sourceFingerprintOf(fingerprint(spec.sourceFingerprint ?? `fp-${key}`)),
    sourceRevision: spec.sourceRevision ?? 1,
    mirroredTime: spec.time ?? inHistoric,
    mirroredRecurring: spec.recurring ?? false,
    destination: remoteRef(destinationId, spec.destinationHandle ?? destinationId),
    destinationCalendar: spec.destinationCalendar ?? destinationCalendar,
    mirrorFingerprint: mirrorFingerprintOf(fingerprint(spec.mirrorFingerprint ?? `mirror-${key}`)),
    precondition: spec.precondition ?? {
      kind: "matchesVersion",
      version: version(`v-${destinationId}-1`),
    },
  };
};

interface CoverageSpec {
  readonly calendar?: CalendarKey;
  readonly ingestWindowStart?: string | null;
  readonly ingestWindowEnd?: string | null;
  readonly recordedAt?: string | null;
  readonly historicRange?: TimeWindow | null;
  readonly futureRange?: TimeWindow | null;
}

const instantOrNull = (value: string | null | undefined, fallback: string): Instant | null => {
  if (value === null) {
    return null;
  }
  return instant(value ?? fallback);
};

const rangeOrNull = (
  value: TimeWindow | null | undefined,
  fallback: TimeWindow,
): TimeWindow | null => {
  if (value === null) {
    return null;
  }
  return value ?? fallback;
};

const storedCoverage = (spec: CoverageSpec = {}): StoredSourceCoverage => ({
  calendar: spec.calendar ?? sourceCalendarA,
  ingestWindowStart: instantOrNull(spec.ingestWindowStart, mirrorWindow.start.value),
  ingestWindowEnd: instantOrNull(spec.ingestWindowEnd, mirrorWindow.end.value),
  ingestWindowRecordedAt: instantOrNull(spec.recordedAt, recordedRecently.value),
  historicRange: rangeOrNull(spec.historicRange, historicRange),
  futureRange: rangeOrNull(spec.futureRange, futureRange),
});

const zeroedCounters = (): Record<WithholdingCounter, number> => ({
  overBudgetRecurrenceSeries: 0,
  emptyTimeRange: 0,
  invertedTimeRange: 0,
  missingSourceEventUid: 0,
  excludedBySyncPolicy: 0,
  outsideReconciliationWindow: 0,
  unparseableStoredPayload: 0,
  unresolvableTimeZone: 0,
  supersededRevision: 0,
});

const completeRead = (): LocalReadCompleteness => ({
  withheldCounts: zeroedCounters(),
  withheld: [],
});

const withheldFrom = (
  events: readonly WithheldEvent[],
  sourceCalendar: CalendarKey = sourceCalendarA,
): readonly WithheldSourceEvent[] => events.map((event) => ({ sourceCalendar, event }));

const incompleteRead = (
  counter: WithholdingCounter,
  withheld: readonly WithheldSourceEvent[],
): LocalReadCompleteness => ({
  withheldCounts: { ...zeroedCounters(), [counter]: withheld.length },
  withheld,
});

const witnessFor = (calendars: readonly CalendarKey[]): SourceReadWitness => ({
  sourceCalendarsBeforeRemoteRead: calendars,
  sourceCalendarsAtLocalRead: calendars,
  coverageNarrowedAfterRemoteRead: true,
});

const normalization: DestinationNormalizationWitness = {
  appliedBy: "caller",
  provider: "microsoft",
};

const destinationScope: ListingScope = {
  calendar: destinationCalendar,
  window: mirrorWindow,
  expandRecurrences: false,
};

interface ListingSpec {
  readonly events?: readonly RemoteEvent[];
  readonly removals?: readonly Removal[];
  readonly withheld?: readonly WithheldEvent[];
  readonly scope?: ListingScope;
}

const destinationSnapshot = (spec: ListingSpec = {}): ChangeListing => {
  const scope = spec.scope ?? destinationScope;
  return {
    kind: "snapshot",
    scope,
    coverage: { covered: scope.window, calendar: scope.calendar },
    events: spec.events ?? [],
    removals: spec.removals ?? [],
    withheld: spec.withheld ?? [],
    cursor: null,
    diagnostics: emptyDiagnostics,
  };
};

const destinationPartial = (spec: ListingSpec = {}): ChangeListing => {
  const scope = spec.scope ?? destinationScope;
  return {
    kind: "partial",
    scope,
    events: spec.events ?? [],
    withheld: spec.withheld ?? [],
    continuation: { kind: "continuation", value: "page-2", scope },
    diagnostics: emptyDiagnostics,
  };
};

const destinationCursorLost = (spec: ListingSpec = {}): ChangeListing => ({
  kind: "cursorLost",
  scope: spec.scope ?? destinationScope,
  diagnostics: emptyDiagnostics,
});

interface MirrorEventSpec {
  readonly id: string;
  readonly uid: string;
  readonly deleteHandle?: string;
  readonly version?: string;
  readonly fingerprint?: string;
  readonly time?: EventTime;
  readonly title?: string;
  readonly description?: string | null;
  readonly location?: string | null;
}

const mirrorEventFacts = (spec: MirrorEventSpec): Omit<RemoteEvent, "provenance"> => ({
  id: remoteId(spec.id),
  deleteHandle: deleteHandle(spec.deleteHandle ?? spec.id),
  uid: uid(spec.uid),
  calendar: destinationCalendar,
  revision: 1,
  version: version(spec.version ?? `v-${spec.id}-1`),
  content: {
    title: spec.title ?? spec.id,
    description: spec.description ?? null,
    location: spec.location ?? null,
    availability: "busy",
    visibility: "default",
    recurrence: null,
    time: spec.time ?? inHistoric,
  },
  fingerprint: fingerprint(spec.fingerprint ?? `mirror-${spec.uid}`),
});

const ownMirrorEvent = (spec: MirrorEventSpec, by = ourInstallation): RemoteEvent => ({
  ...mirrorEventFacts(spec),
  provenance: { kind: "ours", installation: by },
});

const indeterminateMirrorEvent = (spec: MirrorEventSpec): RemoteEvent => ({
  ...mirrorEventFacts(spec),
  provenance: { kind: "indeterminate" },
});

const foreignMirrorEvent = (spec: MirrorEventSpec): RemoteEvent => ({
  ...mirrorEventFacts(spec),
  provenance: { kind: "foreign" },
});

interface InputSpec {
  readonly mappedSourceCalendars?: readonly CalendarKey[];
  readonly storedSourceEvents?: readonly StoredSourceEvent[];
  readonly mirrors?: readonly MirrorRow[];
  readonly destinationListing?: ChangeListing;
  readonly storedCoverage?: readonly StoredSourceCoverage[];
  readonly completeness?: LocalReadCompleteness;
  readonly witness?: SourceReadWitness;
  readonly normalization?: DestinationNormalizationWitness;
  readonly mirrorWindow?: TimeWindow;
  readonly destination?: WritableCalendar;
  readonly installation?: InstallationId;
}

const syncInput = (spec: InputSpec = {}): DestinationSyncInput => {
  const mapped = spec.mappedSourceCalendars ?? [sourceCalendarA];
  return {
    installation: spec.installation ?? ourInstallation,
    destination: spec.destination ?? writableDestination,
    capabilities,
    mirrorWindow: spec.mirrorWindow ?? mirrorWindow,
    mappedSourceCalendars: mapped,
    storedSourceEvents: spec.storedSourceEvents ?? [],
    mirrors: spec.mirrors ?? [],
    destinationListing: spec.destinationListing ?? destinationSnapshot(),
    storedCoverage: spec.storedCoverage ?? mapped.map((calendar) => storedCoverage({ calendar })),
    completeness: spec.completeness ?? completeRead(),
    witness: spec.witness ?? witnessFor(mapped),
    normalization: spec.normalization ?? normalization,
  };
};

interface OptionsSpec {
  readonly asOf?: Instant;
  readonly maxCoverageAgeSeconds?: number;
  readonly limits?: ShadowOptions["limits"];
  readonly withinWindow?: ShadowOptions["withinWindow"];
  readonly plan?: ShadowOptions["plan"];
}

const shadowOptions = (spec: OptionsSpec = {}): ShadowOptions => ({
  asOf: spec.asOf ?? asOf,
  maxCoverageAgeSeconds: spec.maxCoverageAgeSeconds ?? 86_400,
  withinWindow: spec.withinWindow ?? withinTimeWindow,
  limits: spec.limits ?? defaultShadowLimits,
  planLimits: defaultPlanLimits,
  plan: spec.plan ?? planUnitWithReconciliation,
});

export {
  allDayOn,
  asOf,
  canonicalPayload,
  capabilities,
  completeRead,
  destinationCalendar,
  destinationCursorLost,
  destinationPartial,
  destinationScope,
  destinationSnapshot,
  emptyDiagnostics,
  foreignInstallation,
  foreignMirrorEvent,
  futureRange,
  historicRange,
  inFuture,
  inHistoric,
  incompleteRead,
  indeterminateMirrorEvent,
  masterIdentity,
  mirrorRow,
  mirrorWindow,
  normalization,
  otherCalendar,
  ourInstallation,
  overrideIdentity,
  ownMirrorEvent,
  recordedRecently,
  recurringCanonicalPayload,
  remoteRef,
  shadowOptions,
  slotIdentity,
  sourceCalendarA,
  sourceCalendarB,
  storedCoverage,
  storedSourceEvent,
  syncInput,
  timedAt,
  withheldFrom,
  witnessFor,
  writableDestination,
  zeroedCounters,
};
export type {
  CanonicalContentSpec,
  CoverageSpec,
  InputSpec,
  ListingSpec,
  MirrorEventSpec,
  MirrorSpec,
  OptionsSpec,
  StoredEventSpec,
};
