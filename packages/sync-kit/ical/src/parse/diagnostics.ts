import type { BoundedSample, ListingDiagnostics } from "@keeper.sh/sync-protocol";
import type { IcsLimits } from "../options";
import { eventIdentityKey } from "./identity";
import type { EventIdentity } from "./identity";
import type { VeventOutcome } from "./parse-vevent";

const boundedSampleOf = (keys: readonly string[], limits: IcsLimits): BoundedSample => {
  const distinct = [...new Set(keys)];
  return { sample: distinct.slice(0, limits.maxDiagnosticSample), total: distinct.length };
};

const withheldIdentityKey = (outcome: Extract<VeventOutcome, { kind: "withheld" }>): string => {
  if (outcome.identity.uid) {
    const identity: EventIdentity = { kind: "master", uid: outcome.identity.uid };
    return eventIdentityKey(identity);
  }
  return `remote|${outcome.identity.id.value}`;
};

const keysOfKind = (
  outcomes: readonly VeventOutcome[],
  kind: VeventOutcome["kind"],
): readonly string[] =>
  outcomes.flatMap((outcome) => {
    if (outcome.kind !== kind) {
      return [];
    }
    if (outcome.kind === "withheld") {
      return [withheldIdentityKey(outcome)];
    }
    if (outcome.kind === "selfAuthored") {
      return [eventIdentityKey(outcome.identity)];
    }
    return [eventIdentityKey(outcome.event.identity)];
  });

const unrepresentableKeys = (outcomes: readonly VeventOutcome[]): readonly string[] =>
  outcomes.flatMap((outcome) => {
    if (outcome.kind !== "withheld" || outcome.reason !== "unrepresentableTime") {
      return [];
    }
    return [withheldIdentityKey(outcome)];
  });

const toListingDiagnostics = (
  outcomes: readonly VeventOutcome[],
  limits: IcsLimits,
): ListingDiagnostics => ({
  withheld: boundedSampleOf(keysOfKind(outcomes, "withheld"), limits),
  selfAuthored: boundedSampleOf(keysOfKind(outcomes, "selfAuthored"), limits),
  unrepresentable: boundedSampleOf(unrepresentableKeys(outcomes), limits),
  pagesFetched: 1,
});

export { toListingDiagnostics, withheldIdentityKey };
