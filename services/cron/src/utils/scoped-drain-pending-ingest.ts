import {
  PENDING_CORRELATION_KEY,
  PENDING_INGEST_KEY,
  PENDING_REWAKE_KEY,
} from "@keeper.sh/calendar";
import { releaseClaimsOnFailure, reserveClaimedMembers } from "./pending-ingest-claim";
import type { ClaimReleaseRedis, ClaimReserveRedis } from "./pending-ingest-claim";
import type { PendingIngestMember } from "./drain-pending-ingest";

interface ClaimMetadataRedis {
  hmget: (key: string, ...members: string[]) => Promise<(string | null)[]>;
  hsetnx: (key: string, member: string, value: string) => Promise<number>;
}

const REWAKE_SEED = "0";

interface ScopedClaimRedis extends ClaimMetadataRedis, ClaimReleaseRedis, ClaimReserveRedis {
  zscore: (key: string, member: string) => Promise<string | null>;
}

const attachCorrelationIds = (
  members: PendingIngestMember[],
  ids: (string | null)[],
): PendingIngestMember[] => members.map((member, index) => {
  const correlationId = ids[index] ?? "";
  if (correlationId.length === 0) {
    return member;
  }
  return { ...member, correlationId };
});

const attachRewakeCounters = (
  members: PendingIngestMember[],
  counters: (string | null)[],
): PendingIngestMember[] => members.map((member, index) => {
  const rewake = counters[index] ?? "";
  if (rewake.length === 0) {
    return member;
  }
  return { ...member, rewake };
});

const readClaimMetadata = async (
  redis: ClaimMetadataRedis,
  members: PendingIngestMember[],
): Promise<PendingIngestMember[]> => {
  const calendarIds = members.map((member) => member.calendarId);
  const [correlationIds, counters] = await Promise.all([
    redis.hmget(PENDING_CORRELATION_KEY, ...calendarIds),
    redis.hmget(PENDING_REWAKE_KEY, ...calendarIds),
  ]);
  return attachRewakeCounters(
    attachCorrelationIds(members, correlationIds),
    counters,
  );
};

const claimMetadataWithSeededRewake = async (
  redis: ClaimMetadataRedis,
  members: PendingIngestMember[],
): Promise<PendingIngestMember[]> => {
  const tagged = await readClaimMetadata(redis, members);
  const unseeded = tagged.filter((member) => (member.rewake ?? "").length === 0);
  if (unseeded.length === 0) {
    return tagged;
  }
  await Promise.all(unseeded.map((member) =>
    redis.hsetnx(PENDING_REWAKE_KEY, member.calendarId, REWAKE_SEED)));
  return readClaimMetadata(redis, members);
};

/*
 * The signal only carries ids. Scores are re-read here so a calendar rewoken between
 * signal and drain releases against its newer score instead of being dropped, and so
 * an id already drained by the periodic tick is skipped rather than resurrected.
 */
const createScopedClaimPending = (
  redis: ScopedClaimRedis,
  calendarIds: string[],
) => async (limit: number): Promise<PendingIngestMember[]> => {
  const scoped = calendarIds.slice(0, limit);
  const scores = await Promise.all(
    scoped.map((calendarId) => redis.zscore(PENDING_INGEST_KEY, calendarId)),
  );

  const woken: PendingIngestMember[] = [];
  for (const [index, calendarId] of scoped.entries()) {
    const score = Number(scores[index]);
    if (scores[index] !== null && Number.isFinite(score)) {
      woken.push({ calendarId, score });
    }
  }

  const members = await reserveClaimedMembers(redis, woken);
  if (members.length === 0) {
    return members;
  }

  return releaseClaimsOnFailure(
    redis,
    members,
    () => claimMetadataWithSeededRewake(redis, members),
  );
};

export {
  attachCorrelationIds,
  attachRewakeCounters,
  claimMetadataWithSeededRewake,
  createScopedClaimPending,
  readClaimMetadata,
};
export type { ClaimMetadataRedis, ScopedClaimRedis };
