import { assertNever } from "@keeper.sh/sync-protocol";
import { calendarKeyString, tombstoneCauses, unresolvedReasons } from "@keeper.sh/sync-reconcile";
import { coverageProofRefusals } from "../input/stored-coverage";
import type { Catalog } from "./catalog";
import type { DeletionEntry } from "./entries";
import type { ShadowLimits } from "./limits";
import { boundedIdentifiers, boundedSampleOf } from "./sample";
import type { SampleBounds } from "./sample";

type LoggableValue = boolean | number | string;

type LoggableCatalog = Readonly<Record<string, LoggableValue>>;

type Cataloged = Extract<Catalog, { kind: "cataloged" }>;

const deletionBounds = (limits: ShadowLimits): SampleBounds => ({
  count: limits.deletionSampleCount,
  bytes: limits.deletionSampleBytes,
  identifierBytes: limits.identifierBytes,
});

const contextBounds = (limits: ShadowLimits): SampleBounds => ({
  count: limits.contextSampleCount,
  bytes: limits.contextSampleBytes,
  identifierBytes: limits.identifierBytes,
});

const deletionsByCause = (deletions: readonly DeletionEntry[]): LoggableCatalog =>
  Object.fromEntries(
    tombstoneCauses.map((cause) => [
      `shadow.deletions.cause.${cause}`,
      deletions.filter((entry) => entry.cause === cause).length,
    ]),
  );

const unresolvedByReason = (catalog: Cataloged): LoggableCatalog =>
  Object.fromEntries(
    unresolvedReasons.map((reason) => [
      `shadow.unresolved.${reason}.total`,
      catalog.unresolved.filter((entry) => entry.reason === reason).length,
    ]),
  );

const coverageRefusalCounts = (catalog: Cataloged): LoggableCatalog =>
  Object.fromEntries(
    coverageProofRefusals.map((refusal) => [
      `shadow.coverage.refusal.${refusal}`,
      catalog.coverage.filter((verdict) => verdict.refusal === refusal).length,
    ]),
  );

const countOf = <Entry>(entries: readonly Entry[], matches: (entry: Entry) => boolean): number =>
  entries.filter((entry) => matches(entry)).length;

const deletionTokenSeparator = "|";

const deletionToken = (entry: DeletionEntry): string =>
  [
    entry.identityKey,
    entry.remoteEventId.value,
    entry.deleteHandle.value,
    entry.handleSource,
    entry.origin,
    entry.cause,
  ].join(deletionTokenSeparator);

const deletionSample = (catalog: Cataloged, limits: ShadowLimits): LoggableCatalog => {
  const bounded = boundedSampleOf(
    catalog.deletions.map((entry) => deletionToken(entry)),
    deletionBounds(limits),
  );
  return {
    "shadow.deletions.sample": bounded.sample,
    "shadow.deletions.sample_omitted": bounded.omitted,
  };
};

const renderCataloged = (catalog: Cataloged, limits: ShadowLimits): LoggableCatalog => ({
  "shadow.outcome": catalog.kind,
  "shadow.destination": calendarKeyString(catalog.destination),
  "shadow.deletions.total": catalog.deletions.length,
  ...deletionSample(catalog, limits),
  ...deletionsByCause(catalog.deletions),
  "shadow.deletions.origin.replace_retire": countOf(
    catalog.deletions,
    (entry) => entry.origin === "replaceRetire",
  ),
  "shadow.deletions.handle_fallback_count": countOf(
    catalog.deletions,
    (entry) => entry.handleSource === "storedMapping",
  ),
  "shadow.deletions.unproven_count": countOf(
    catalog.deletions,
    (entry) => entry.licensedBy === "unproven",
  ),
  "shadow.replacements.total": catalog.replacements.length,
  "shadow.replacements.sample": boundedIdentifiers(
    catalog.replacements.map((entry) => entry.identityKey),
    contextBounds(limits),
  ),
  "shadow.creations.total": catalog.creations.length,
  "shadow.creations.sample": boundedIdentifiers(
    catalog.creations.map((entry) => entry.identityKey),
    contextBounds(limits),
  ),
  "shadow.updates.total": catalog.updates.length,
  "shadow.updates.sample": boundedIdentifiers(
    catalog.updates.map((entry) => entry.identityKey),
    contextBounds(limits),
  ),
  "shadow.forgotten_rows.total": catalog.forgottenLocalRows.length,
  "shadow.forgotten_rows.sample": boundedIdentifiers(
    catalog.forgottenLocalRows.map((entry) => entry.identityKey),
    contextBounds(limits),
  ),
  ...unresolvedByReason(catalog),
  "shadow.coverage.proven_count": countOf(catalog.coverage, (verdict) => verdict.kind === "proven"),
  "shadow.coverage.unproven_count": countOf(
    catalog.coverage,
    (verdict) => verdict.kind === "unproven",
  ),
  ...coverageRefusalCounts(catalog),
  "shadow.caveats": catalog.caveats.join(","),
  "shadow.identities_considered": catalog.identitiesConsidered,
});

const renderCatalog = (catalog: Catalog, limits: ShadowLimits): LoggableCatalog => {
  switch (catalog.kind) {
    case "cataloged": {
      return renderCataloged(catalog, limits);
    }
    case "notTranslated": {
      return {
        "shadow.outcome": catalog.kind,
        "shadow.destination": calendarKeyString(catalog.destination),
        "shadow.not_translated_reason": catalog.reason,
        "shadow.not_translated_detail": catalog.detail,
      };
    }
    case "plannerRefused": {
      return {
        "shadow.outcome": catalog.kind,
        "shadow.destination": calendarKeyString(catalog.destination),
        "shadow.planner_refused_source": calendarKeyString(catalog.sourceCalendar),
        "shadow.planner_invariant": catalog.invariant,
      };
    }
    case "shadowRefused": {
      return {
        "shadow.outcome": catalog.kind,
        "shadow.destination": calendarKeyString(catalog.destination),
        "shadow.shadow_invariant": catalog.invariant,
      };
    }
    default: {
      return assertNever(catalog);
    }
  }
};

export { renderCatalog };
export type { LoggableCatalog, LoggableValue };
