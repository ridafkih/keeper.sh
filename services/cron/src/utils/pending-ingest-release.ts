import {
  PENDING_CORRELATION_KEY,
  PENDING_FAILURES_KEY,
  PENDING_INGEST_KEY,
  PENDING_REWAKE_KEY,
} from "@keeper.sh/calendar";
import type { PendingIngestMember } from "./drain-pending-ingest";

const RELEASE_KEY_COUNT = 4;

const RELEASE_IF_UNCHANGED_SCRIPT = `
local removed = {}
for index = 1, #ARGV, 3 do
  local member = ARGV[index]
  local claimedRewake = ARGV[index + 1]
  local claimedScore = tonumber(ARGV[index + 2])
  local currentRewake = redis.call('HGET', KEYS[4], member)
  local currentScore = redis.call('ZSCORE', KEYS[1], member)
  if currentScore and currentRewake and currentRewake == claimedRewake
    and tonumber(currentScore) <= claimedScore then
    redis.call('ZREM', KEYS[1], member)
    redis.call('HDEL', KEYS[2], member)
    redis.call('HDEL', KEYS[3], member)
    redis.call('HDEL', KEYS[4], member)
    removed[#removed + 1] = member
  end
end
return removed
`;

interface ReleaseRedis {
  eval: (script: string, numKeys: number, ...rest: (string | number)[]) => Promise<unknown>;
}

const buildReleaseArguments = (members: PendingIngestMember[]): string[] =>
  members.flatMap((member) => [member.calendarId, member.rewake ?? "", String(member.score)]);

const releaseUnchangedMembers = async (
  redis: ReleaseRedis,
  members: PendingIngestMember[],
): Promise<string[]> => {
  const args = buildReleaseArguments(members);
  if (args.length === 0) {
    return [];
  }

  const removed = await redis.eval(
    RELEASE_IF_UNCHANGED_SCRIPT,
    RELEASE_KEY_COUNT,
    PENDING_INGEST_KEY,
    PENDING_FAILURES_KEY,
    PENDING_CORRELATION_KEY,
    PENDING_REWAKE_KEY,
    ...args,
  );

  if (!Array.isArray(removed)) {
    return [];
  }
  return removed.map(String);
};

export {
  buildReleaseArguments,
  PENDING_CORRELATION_KEY,
  PENDING_FAILURES_KEY,
  PENDING_INGEST_KEY,
  PENDING_REWAKE_KEY,
  RELEASE_IF_UNCHANGED_SCRIPT,
  releaseUnchangedMembers,
};
export type { ReleaseRedis };
