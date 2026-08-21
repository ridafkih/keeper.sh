import { INGEST_SOURCE_TIMEOUT_MS } from "@keeper.sh/constants";
import type { PendingIngestMember } from "./drain-pending-ingest";

const PENDING_CLAIM_PREFIX = "push:pending-claim";

const CLAIM_RESERVATION_TTL_MS = INGEST_SOURCE_TIMEOUT_MS * 2;

interface ClaimReserveRedis {
  set: (
    key: string,
    value: string,
    expiryToken: "PX",
    ttlMs: number,
    onlyIfAbsent: "NX",
  ) => Promise<string | null>;
}

interface ClaimReleaseRedis {
  del: (...keys: string[]) => Promise<number>;
}

const buildClaimKey = (calendarId: string): string =>
  `${PENDING_CLAIM_PREFIX}:${calendarId}`;

const reserveClaimedMembers = async (
  redis: ClaimReserveRedis,
  members: PendingIngestMember[],
): Promise<PendingIngestMember[]> => {
  const grants = await Promise.all(members.map((member) => redis.set(
    buildClaimKey(member.calendarId),
    "1",
    "PX",
    CLAIM_RESERVATION_TTL_MS,
    "NX",
  )));
  return members.filter((_member, index) => grants[index] !== null);
};

const releaseClaimedCalendars = async (
  redis: ClaimReleaseRedis,
  calendarIds: string[],
): Promise<void> => {
  if (calendarIds.length === 0) {
    return;
  }
  await redis.del(...calendarIds.map((calendarId) => buildClaimKey(calendarId)));
};

const ignoreReleaseFailure = (): null => null;

const releaseClaimsOnFailure = async <Claimed>(
  redis: ClaimReleaseRedis,
  members: PendingIngestMember[],
  claim: () => Promise<Claimed>,
): Promise<Claimed> => {
  try {
    return await claim();
  } catch (error) {
    await releaseClaimedCalendars(
      redis,
      members.map((member) => member.calendarId),
    ).catch(ignoreReleaseFailure);
    throw error;
  }
};

export {
  buildClaimKey,
  CLAIM_RESERVATION_TTL_MS,
  PENDING_CLAIM_PREFIX,
  releaseClaimedCalendars,
  releaseClaimsOnFailure,
  reserveClaimedMembers,
};
export type { ClaimReleaseRedis, ClaimReserveRedis };
