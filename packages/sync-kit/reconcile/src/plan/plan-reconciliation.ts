import type { ChangeListing, WithheldEvent } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { ProvenCoverage } from "../coverage";
import { ReconcileInternalDataError } from "../errors";
import { calendarKeyString } from "../identity/calendar-key";
import { joinOnNul } from "../identity/nul";
import type { SourceIdentity } from "../identity/source-identity";
import { sourceIdentityKey, uidPresenceKey } from "../identity/source-identity";
import type { ReconciliationPolicy } from "../policy";
import type { ListingAuthority } from "../presence/authority";
import { listingAuthority, speaksForAbsence } from "../presence/authority";
import type { PresenceBasis } from "../presence/presence-basis";
import { presenceBasis, withShieldedKeys } from "../presence/presence-basis";
import { removalBasis } from "../presence/removals";
import { writeBasis } from "../presence/write-basis";
import { ambiguousIdentities } from "../state/ambiguity";
import type { IdentifiedEvent } from "../state/dedupe";
import { dedupeObservations } from "../state/dedupe";
import type { KnownIndex, KnownState } from "../state/known";
import { indexKnownEvents } from "../state/known";
import type { Mapping, MappingIndexes, MappingSet } from "../state/mappings";
import { indexMappings } from "../state/mappings";
import type { MirrorIndex } from "../state/mirrors";
import { indexMirrors } from "../state/mirrors";
import type { Observation } from "../state/observations";
import { classifyObservations } from "../state/observations";
import type { ObservedState } from "../state/observed";
import { sameTimeWindow } from "../state/time-window";
import { decideCursor } from "./cursor";
import { boundedSample } from "./diagnostics";
import { classifyProvenance } from "./echo";
import { comparePlannedWrites, compareText } from "./order";
import type { Plan, Unresolved } from "./plan";
import { deriveTombstones } from "./tombstones";
import { deriveWrites } from "./writes";

const usableObservations = (observations: readonly Observation[]): readonly IdentifiedEvent[] =>
  observations.flatMap((observation) => {
    if (observation.kind !== "usable") {
      return [];
    }
    return [{ identity: observation.identity, event: observation.event }];
  });

const echoedKeys = (observations: readonly Observation[]): readonly string[] =>
  observations.flatMap((observation) => {
    if (observation.kind !== "suppressedEcho") {
      return [];
    }
    return [sourceIdentityKey(observation.identity)];
  });

const shieldedKeys = (observations: readonly Observation[]): readonly string[] =>
  observations.flatMap((observation) => {
    if (observation.kind === "usable") {
      return [];
    }
    if (observation.event.uid.value.length === 0) {
      return [];
    }
    return [uidPresenceKey(observation.event.uid)];
  });

const observedIdentityKeys = (observations: readonly Observation[]): readonly string[] =>
  observations.flatMap((observation) => {
    if (observation.kind === "unidentified") {
      return [];
    }
    return [sourceIdentityKey(observation.identity)];
  });

const unusableObservationsReported = (
  observations: readonly Observation[],
): readonly Unresolved[] =>
  observations.flatMap((observation): readonly Unresolved[] => {
    switch (observation.kind) {
      case "unidentified": {
        return [{ identity: null, id: observation.event.id, reason: "missingIdentity" }];
      }
      case "indeterminate": {
        return [
          {
            identity: observation.identity,
            id: observation.event.id,
            reason: "provenanceIndeterminate",
          },
        ];
      }
      case "unsupported": {
        return [
          {
            identity: observation.identity,
            id: observation.event.id,
            reason: "unsupportedByDestination",
          },
        ];
      }
      case "usable":
      case "suppressedEcho": {
        return [];
      }
      default: {
        return assertNever(observation);
      }
    }
  });

const withheldReport = (withheld: WithheldEvent, known: KnownIndex): Unresolved => {
  const anonymous: Unresolved = {
    identity: null,
    id: withheld.id ?? null,
    reason: "withheldBySource",
  };
  if (!withheld.uid) {
    return anonymous;
  }
  const rows = known.byUid.get(withheld.uid.value) ?? [];
  const only = rows.at(0);
  if (rows.length !== 1 || !only) {
    return anonymous;
  }
  return { identity: only.identity, id: withheld.id ?? null, reason: "withheldBySource" };
};

const withheldReported = (listing: ChangeListing, known: KnownIndex): readonly Unresolved[] =>
  (listing.withheld ?? []).map((withheld) => withheldReport(withheld, known));

const unattributableMirrorsReported = (
  mirrors: MirrorIndex,
  indexes: MappingIndexes,
  policy: ReconciliationPolicy,
): readonly Unresolved[] =>
  [...mirrors.byId.values()].flatMap((event): readonly Unresolved[] => {
    if (indexes.byDestinationId.has(event.id.value)) {
      return [];
    }
    if (classifyProvenance(event, policy.installation) !== "indeterminate") {
      return [];
    }
    return [{ identity: null, id: event.id, reason: "provenanceIndeterminate" }];
  });

const provenCoverageOf = (
  observed: ObservedState,
  known: KnownState,
  policy: ReconciliationPolicy,
): ProvenCoverage => {
  if (observed.source.kind !== "snapshot") {
    return { kind: "unproven" };
  }
  return policy.coverageBySource.get(calendarKeyString(known.calendar)) ?? { kind: "unproven" };
};

const orphanedMappingsIn = (
  indexes: MappingIndexes,
  presence: PresenceBasis,
  authority: ListingAuthority,
): readonly Mapping[] => {
  if (!speaksForAbsence(authority)) {
    return [];
  }
  return [...indexes.bySourceIdentity.values()].filter(
    (mapping) => !presence.presentKeys.has(sourceIdentityKey(mapping.sourceIdentity)),
  );
};

const identityLabelOf = (identity: SourceIdentity | null): string => {
  if (!identity) {
    return "";
  }
  return sourceIdentityKey(identity);
};

const sortKeyOfUnresolved = (item: Unresolved): string =>
  joinOnNul([item.reason, identityLabelOf(item.identity), item.id?.value ?? ""]);

const labelOfUnresolved = (item: Unresolved): string => {
  const identity = identityLabelOf(item.identity);
  if (identity.length > 0) {
    return identity;
  }
  return item.id?.value ?? "";
};

interface Keyed<Item> {
  readonly item: Item;
  readonly key: string;
}

const keyedWith = <Item>(items: readonly Item[], keyOf: (item: Item) => string): Keyed<Item>[] =>
  items.map((item) => ({ item, key: keyOf(item) }));

const byKeyAscending = <Item>(left: Keyed<Item>, right: Keyed<Item>): number =>
  compareText(left.key, right.key);

const unkeyed = <Item>(keyed: readonly Keyed<Item>[]): readonly Item[] =>
  keyed.map((entry) => entry.item);

const inKeyOrder = <Item>(
  items: readonly Item[],
  keyOf: (item: Item) => string,
): readonly Item[] => unkeyed(keyedWith(items, keyOf).toSorted(byKeyAscending));

const ensureOneSourceCalendar = (known: KnownState): void => {
  const calendar = calendarKeyString(known.calendar);
  for (const event of known.events) {
    if (calendarKeyString(event.sourceCalendar) !== calendar) {
      throw new ReconcileInternalDataError(
        "a known row was recorded against a different source calendar than the known state",
      );
    }
  }
};

const planReconciliation = (
  observed: ObservedState,
  known: KnownState,
  mappings: MappingSet,
  policy: ReconciliationPolicy,
): Plan => {
  ensureOneSourceCalendar(known);
  const indexes = indexMappings(mappings, policy.destination.key);
  const knownIndex = indexKnownEvents(known);
  const { source } = observed;
  const authority = listingAuthority(source);
  const observations = classifyObservations(writeBasis(source), policy);
  const presence = withShieldedKeys(presenceBasis(source), shieldedKeys(observations));
  const mirrors = indexMirrors(observed);
  const coverage = provenCoverageOf(observed, known, policy);
  const usable = usableObservations(observations);
  const ambiguity = ambiguousIdentities(usable);
  const deduped = dedupeObservations(
    usable.filter((observation) => !ambiguity.keys.has(sourceIdentityKey(observation.identity))),
  );
  const written = deriveWrites({
    observations: deduped.kept,
    orphanedMappings: orphanedMappingsIn(indexes, presence, authority),
    known: knownIndex,
    indexes,
    mirrors,
    policy,
  });
  const retired = deriveTombstones({
    removals: removalBasis(source, known, presence, policy),
    known,
    knownIndex,
    indexes,
    mirrors,
    coverage,
    claimedMappingKeys: written.claimedMappingKeys,
    authority,
    scopeIsTheMirrorWindow: sameTimeWindow(source.scope.window, policy.mirrorWindow),
    policy,
  });
  const unresolved = inKeyOrder(
    [
      ...unusableObservationsReported(observations),
      ...ambiguity.identities.map(
        (identity): Unresolved => ({ identity, id: null, reason: "ambiguousIdentity" }),
      ),
      ...withheldReported(source, knownIndex),
      ...unattributableMirrorsReported(mirrors, indexes, policy),
      ...written.unresolved,
      ...retired.unresolved,
    ],
    sortKeyOfUnresolved,
  );
  const tombstones = inKeyOrder(retired.tombstones, (tombstone) =>
    sourceIdentityKey(tombstone.identity),
  );
  const conflicts = inKeyOrder(written.conflicts, (conflict) =>
    sourceIdentityKey(conflict.identity),
  );
  const considered = new Set([
    ...known.events.map((event) => sourceIdentityKey(event.identity)),
    ...observedIdentityKeys(observations),
  ]);
  return {
    writes: written.writes.toSorted(comparePlannedWrites),
    tombstones,
    cursor: decideCursor(observed, known, policy),
    coverage,
    unresolved,
    conflicts,
    diagnostics: {
      unresolved: boundedSample(
        unresolved.map((item) => labelOfUnresolved(item)),
        policy.limits,
      ),
      conflicts: boundedSample(
        conflicts.map((conflict) => sourceIdentityKey(conflict.identity)),
        policy.limits,
      ),
      tombstoned: boundedSample(
        tombstones.map((tombstone) => sourceIdentityKey(tombstone.identity)),
        policy.limits,
      ),
      suppressedEchoes: boundedSample(echoedKeys(observations), policy.limits),
      supersededObservations: boundedSample(deduped.supersededKeys, policy.limits),
      identitiesConsidered: considered.size,
    },
  };
};

export { planReconciliation };
