import type { EventTime, WriteIntent } from "@keeper.sh/sync-protocol";
import type {
  Conflict,
  CursorDecision,
  Plan,
  PlannedWrite,
  ProvenCoverage,
  SourceIdentity,
  TombstoneCause,
  Tombstone,
  Unresolved,
} from "@keeper.sh/sync-reconcile";
import {
  deleteHandle,
  fingerprint,
  idempotencyKey,
  instant,
  remoteId,
  version,
} from "./handles";
import {
  futureRange,
  historicRange,
  inHistoric,
  ourInstallation,
  sourceCalendarA,
  writableDestination,
} from "./fixtures";

const provenCoverage: ProvenCoverage = {
  kind: "proven",
  calendar: sourceCalendarA,
  historic: historicRange,
  future: futureRange,
};

const unprovenCoverage: ProvenCoverage = { kind: "unproven" };

interface ContentSpec {
  readonly title?: string;
  readonly description?: string | null;
  readonly location?: string | null;
  readonly time?: EventTime;
}

const normalizedContent = (key: string, spec: ContentSpec = {}) => ({
  kind: "normalized" as const,
  provider: "microsoft",
  content: {
    title: spec.title ?? key,
    description: spec.description ?? null,
    location: spec.location ?? null,
    availability: "busy" as const,
    visibility: "default" as const,
    recurrence: null,
    time: spec.time ?? inHistoric,
  },
  fingerprint: fingerprint(`fp-${key}`),
});

const createIntent = (key: string, spec: ContentSpec = {}): Extract<WriteIntent, { kind: "create" }> => ({
  kind: "create",
  calendar: writableDestination,
  idempotencyKey: idempotencyKey(`idem-${key}`),
  content: normalizedContent(key, spec),
  provenance: { kind: "ours", installation: ourInstallation },
  precondition: { kind: "absent" },
});

const deleteIntent = (key: string): Extract<WriteIntent, { kind: "delete" }> => ({
  kind: "delete",
  calendar: writableDestination,
  target: deleteHandle(`handle-${key}`),
  precondition: { kind: "matchesVersion", version: version(`v-${key}-1`) },
  reason: "sourceDeleted",
});

const updateIntent = (key: string, spec: ContentSpec = {}): Extract<WriteIntent, { kind: "update" }> => ({
  kind: "update",
  calendar: writableDestination,
  target: remoteId(`mirror-${key}`),
  content: normalizedContent(key, spec),
  precondition: { kind: "matchesVersion", version: version(`v-${key}-1`) },
});

const createWrite = (identity: SourceIdentity, spec: ContentSpec = {}): PlannedWrite => ({
  kind: "single",
  at: instant("2026-03-10T09:00:00.000Z"),
  identity,
  intent: createIntent(identity.uid.value, spec),
});

const updateWrite = (identity: SourceIdentity, spec: ContentSpec = {}): PlannedWrite => ({
  kind: "single",
  at: instant("2026-03-10T09:00:00.000Z"),
  identity,
  intent: updateIntent(identity.uid.value, spec),
});

const replaceWrite = (identity: SourceIdentity, spec: ContentSpec = {}): PlannedWrite => ({
  kind: "replace",
  at: instant("2026-03-10T09:00:00.000Z"),
  identity,
  retire: deleteIntent(identity.uid.value),
  recreate: createIntent(identity.uid.value, spec),
});

const retireTombstone = (identity: SourceIdentity, cause: TombstoneCause): Tombstone => ({
  kind: "retireMirror",
  identity,
  cause,
  handle: deleteHandle(`handle-${identity.uid.value}`),
  precondition: { kind: "matchesVersion", version: version(`v-${identity.uid.value}-1`) },
});

const forgetTombstone = (identity: SourceIdentity, cause: TombstoneCause): Tombstone => ({
  kind: "forgetKnownRow",
  identity,
  cause,
});

interface PlanSpec {
  readonly writes?: readonly PlannedWrite[];
  readonly tombstones?: readonly Tombstone[];
  readonly coverage?: ProvenCoverage;
  readonly unresolved?: readonly Unresolved[];
  readonly conflicts?: readonly Conflict[];
  readonly cursor?: CursorDecision;
  readonly identitiesConsidered?: number;
}

const planWith = (spec: PlanSpec = {}): Plan => {
  const tombstones = spec.tombstones ?? [];
  return {
    writes: spec.writes ?? [],
    tombstones,
    cursor: spec.cursor ?? { kind: "hold", reason: "noCursorOffered" },
    coverage: spec.coverage ?? provenCoverage,
    unresolved: spec.unresolved ?? [],
    conflicts: spec.conflicts ?? [],
    diagnostics: {
      unresolved: { sample: [], total: (spec.unresolved ?? []).length },
      conflicts: { sample: [], total: (spec.conflicts ?? []).length },
      tombstoned: { sample: [], total: tombstones.length },
      suppressedEchoes: { sample: [], total: 0 },
      supersededObservations: { sample: [], total: 0 },
      identitiesConsidered: spec.identitiesConsidered ?? tombstones.length + (spec.writes ?? []).length,
    },
  };
};

export {
  createIntent,
  createWrite,
  deleteIntent,
  forgetTombstone,
  planWith,
  provenCoverage,
  replaceWrite,
  retireTombstone,
  unprovenCoverage,
  updateIntent,
  updateWrite,
};
export type { ContentSpec, PlanSpec };
