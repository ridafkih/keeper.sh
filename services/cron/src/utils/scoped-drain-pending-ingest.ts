import { PENDING_CORRELATION_KEY, PENDING_INGEST_KEY } from "@keeper.sh/calendar";
import { reserveClaimedMembers } from "./pending-ingest-claim";
import type { ClaimReserveRedis } from "./pending-ingest-claim";
import type { PendingIngestMember } from "./drain-pending-ingest";

interface ScopedClaimRedis extends ClaimReserveRedis {
  hmget: (key: string, ...members: string[]) => Promise<(string | null)[]>;
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

  return attachCorrelationIds(members, await redis.hmget(
    PENDING_CORRELATION_KEY,
    ...members.map((member) => member.calendarId),
  ));
};

export { attachCorrelationIds, createScopedClaimPending };
export type { ScopedClaimRedis };
