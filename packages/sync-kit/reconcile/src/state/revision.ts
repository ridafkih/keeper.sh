import type { Revision } from "@keeper.sh/sync-protocol";

const rankOfRevision = (revision: Revision): number => {
  if (!Number.isFinite(revision)) {
    return Number.NEGATIVE_INFINITY;
  }
  return revision;
};

const revisionOutranks = (candidate: Revision, baseline: Revision): boolean =>
  rankOfRevision(candidate) > rankOfRevision(baseline);

export { rankOfRevision, revisionOutranks };
