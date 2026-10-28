import type {
  BoundedSample,
  ChangeListing,
  CoverageWindow,
  InstallationId,
  ListingDiagnostics,
  ListingScope,
  RemoteEvent,
  Removal,
  SyncCursor,
  TimeWindow,
  WithheldEvent,
  WithholdReason,
} from "@keeper.sh/sync-protocol";
import { compareCodeUnits } from "../canonical";
import { conformanceLimits } from "../limits";
import { constraintViolatedBy } from "./normalize";
import type { ReportedIdentity } from "./store";

const maximumCoverageMs = 366 * 24 * 60 * 60 * 1000;

interface IdentifiedGroup {
  readonly uid: string;
  readonly revisions: readonly RemoteEvent[];
}

interface ResolvedFeed {
  readonly events: readonly RemoteEvent[];
  readonly withheld: readonly WithheldEvent[];
}

const groupByUid = (events: readonly RemoteEvent[]): readonly IdentifiedGroup[] => {
  const grouped = new Map<string, RemoteEvent[]>();
  for (const event of events) {
    const bucket = grouped.get(event.uid.value);
    if (bucket) {
      bucket.push(event);
      continue;
    }
    grouped.set(event.uid.value, [event]);
  }
  return [...grouped.entries()]
    .map(([uid, revisions]) => ({ uid, revisions }))
    .toSorted((left, right) => compareCodeUnits(left.uid, right.uid));
};

const winnerOf = (revisions: readonly RemoteEvent[]): RemoteEvent => {
  const ordered = revisions.toSorted((left, right) => {
    if (left.revision !== right.revision) {
      return left.revision - right.revision;
    }
    return compareCodeUnits(left.fingerprint.value, right.fingerprint.value);
  });
  const winner = ordered.at(-1);
  if (!winner) {
    throw new Error("a grouped identity must carry at least one revision");
  }
  return winner;
};

const withholdReasonFor = (
  group: IdentifiedGroup,
  winner: RemoteEvent,
): WithholdReason | null => {
  if (group.uid.length === 0) {
    return "missingIdentity";
  }
  if (constraintViolatedBy(winner.content) === null) {
    return null;
  }
  if (group.revisions.length > 1) {
    return "supersededRevisionUnbuildable";
  }
  return "unrepresentableTime";
};

const withheldEntryOf = (winner: RemoteEvent, reason: WithholdReason): WithheldEvent => {
  if (winner.uid.value.length === 0) {
    return { uid: null, id: winner.id, reason };
  }
  return { uid: winner.uid, id: winner.id, reason };
};

const resolveFeed = (events: readonly RemoteEvent[]): ResolvedFeed => {
  const present: RemoteEvent[] = [];
  const withheld: WithheldEvent[] = [];
  for (const group of groupByUid(events)) {
    const winner = winnerOf(group.revisions);
    const reason = withholdReasonFor(group, winner);
    if (reason === null) {
      present.push(winner);
      continue;
    }
    withheld.push(withheldEntryOf(winner, reason));
  }
  return { events: present, withheld };
};

const boundedSample = (identifiers: readonly string[]): BoundedSample => {
  const sample: string[] = [];
  const budget = { length: 0 };
  for (const identifier of identifiers) {
    if (sample.length >= conformanceLimits.diagnosticSampleEntries) {
      break;
    }
    if (budget.length + identifier.length > conformanceLimits.diagnosticSampleUtf16Length) {
      continue;
    }
    sample.push(identifier);
    budget.length += identifier.length;
  }
  return { sample, total: identifiers.length };
};

const identifierOf = (entry: WithheldEvent): string => {
  if (entry.uid === null) {
    return entry.id.value;
  }
  return entry.uid.value;
};

const isSelfAuthored = (event: RemoteEvent, installation: InstallationId): boolean =>
  event.provenance.kind === "ours" && event.provenance.installation.value === installation.value;

const withheldFor = (
  withheld: readonly WithheldEvent[],
  reason: WithholdReason,
): readonly WithheldEvent[] => withheld.filter((entry) => entry.reason === reason);

const diagnosticsOf = (feed: ResolvedFeed, installation: InstallationId): ListingDiagnostics => ({
  withheld: boundedSample(feed.withheld.map((entry) => identifierOf(entry))),
  selfAuthored: boundedSample(
    feed.events.filter((event) => isSelfAuthored(event, installation)).map((event) => event.uid.value),
  ),
  unrepresentable: boundedSample(
    withheldFor(feed.withheld, "unrepresentableTime").map((entry) => identifierOf(entry)),
  ),
  pagesFetched: 1,
});

const emptyDiagnostics: ListingDiagnostics = {
  withheld: { sample: [], total: 0 },
  selfAuthored: { sample: [], total: 0 },
  unrepresentable: { sample: [], total: 0 },
  pagesFetched: 1,
};

const provenCoverage = (window: TimeWindow): TimeWindow => {
  const start = Date.parse(window.start.value);
  const end = Date.parse(window.end.value);
  if (end <= start) {
    return { start: window.start, end: window.start };
  }
  if (end - start <= maximumCoverageMs) {
    return window;
  }
  return {
    start: window.start,
    end: { kind: "instant", value: new Date(start + maximumCoverageMs).toISOString() },
  };
};

const admitsAnything = (covered: TimeWindow): boolean =>
  Date.parse(covered.end.value) > Date.parse(covered.start.value);

const identitiesOf = (feed: ResolvedFeed): readonly ReportedIdentity[] => [
  ...feed.events.map((event) => ({ uid: event.uid, id: event.id })),
  ...feed.withheld.flatMap((entry) => {
    if (entry.uid === null || entry.id === null) {
      return [];
    }
    return [{ uid: entry.uid, id: entry.id }];
  }),
];

const removalsAgainst = (
  reported: readonly ReportedIdentity[],
  present: readonly ReportedIdentity[],
): readonly Removal[] => {
  const known = new Set(present.map((identity) => identity.uid.value));
  return reported
    .filter((identity) => !known.has(identity.uid.value))
    .map((identity) => ({ kind: "deleted", id: identity.id, uid: identity.uid }));
};

const coverageOver = (scope: ListingScope): CoverageWindow => ({
  covered: provenCoverage(scope.window),
  calendar: scope.calendar,
});

const emptySnapshot = (scope: ListingScope, cursor: SyncCursor | null): ChangeListing => ({
  kind: "snapshot",
  scope,
  coverage: coverageOver(scope),
  events: [],
  removals: [],
  withheld: [],
  cursor,
  diagnostics: emptyDiagnostics,
});

const cursorLostListing = (scope: ListingScope): ChangeListing => ({
  kind: "cursorLost",
  scope,
  diagnostics: emptyDiagnostics,
});

export {
  admitsAnything,
  boundedSample,
  coverageOver,
  cursorLostListing,
  diagnosticsOf,
  emptyDiagnostics,
  emptySnapshot,
  identifierOf,
  identitiesOf,
  isSelfAuthored,
  maximumCoverageMs,
  provenCoverage,
  removalsAgainst,
  resolveFeed,
};
export type { ResolvedFeed };
