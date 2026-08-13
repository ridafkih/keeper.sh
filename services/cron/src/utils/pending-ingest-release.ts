import { PENDING_FAILURES_KEY, PENDING_INGEST_KEY } from "@keeper.sh/calendar";
import type { PendingIngestMember } from "./drain-pending-ingest";

const RELEASE_KEY_COUNT = 2;

const RELEASE_IF_UNCHANGED_SCRIPT = `
local removed = {}
for index = 1, #ARGV, 2 do
  local member = ARGV[index]
  local claimedScore = tonumber(ARGV[index + 1])
  local currentScore = redis.call('ZSCORE', KEYS[1], member)
  if currentScore and tonumber(currentScore) <= claimedScore then
    redis.call('ZREM', KEYS[1], member)
    redis.call('HDEL', KEYS[2], member)
    removed[#removed + 1] = member
  end
end
return removed
`;

interface ReleaseRedis {
  eval: (script: string, numKeys: number, ...rest: (string | number)[]) => Promise<unknown>;
}

const buildReleaseArguments = (members: PendingIngestMember[]): string[] =>
  members.flatMap((member) => [member.calendarId, String(member.score)]);

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
    ...args,
  );

  if (!Array.isArray(removed)) {
    return [];
  }
  return removed.map(String);
};

export {
  buildReleaseArguments,
  PENDING_FAILURES_KEY,
  PENDING_INGEST_KEY,
  RELEASE_IF_UNCHANGED_SCRIPT,
  releaseUnchangedMembers,
};
export type { ReleaseRedis };
