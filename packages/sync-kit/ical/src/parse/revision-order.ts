import type { Instant } from "@keeper.sh/sync-protocol";
import { projectCanonicalEvent } from "../canonical/project";
import { encodeCanonicalEvent } from "../canonical/encode";
import type { ParsedVevent } from "./parse-vevent";

const rankOfInstant = (instant: Instant | null): number => {
  if (!instant) {
    return Number.NEGATIVE_INFINITY;
  }
  return Date.parse(instant.value);
};

const rankOfSequence = (sequence: number | null): number => {
  if (sequence === null || !Number.isFinite(sequence)) {
    return -1;
  }
  return sequence;
};

const compareRanks = (left: number, right: number): number => {
  if (left === right) {
    return 0;
  }
  if (left < right) {
    return -1;
  }
  return 1;
};

const compareEventRevisions = (left: ParsedVevent, right: ParsedVevent): number => {
  const bySequence = compareRanks(rankOfSequence(left.revision.sequence), rankOfSequence(right.revision.sequence));
  if (bySequence !== 0) {
    return bySequence;
  }
  const byModified = compareRanks(rankOfInstant(left.revision.lastModified), rankOfInstant(right.revision.lastModified));
  if (byModified !== 0) {
    return byModified;
  }
  const byStamp = compareRanks(rankOfInstant(left.revision.stamp), rankOfInstant(right.revision.stamp));
  if (byStamp !== 0) {
    return byStamp;
  }
  const byCreated = compareRanks(rankOfInstant(left.revision.created), rankOfInstant(right.revision.created));
  if (byCreated !== 0) {
    return byCreated;
  }
  return encodeCanonicalEvent(projectCanonicalEvent(left)).localeCompare(
    encodeCanonicalEvent(projectCanonicalEvent(right)),
  );
};

export { compareEventRevisions };
