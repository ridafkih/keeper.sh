import { MS_PER_MINUTE } from "./time";

interface PushSyncDeadlinePolicy {
  floorMs: number;
  ceilingMs: number;
  writeBufferFactor: number;
  settleGraceMs: number;
}

const PUSH_SYNC_DEADLINE_POLICY: PushSyncDeadlinePolicy = {
  ceilingMs: 25 * MS_PER_MINUTE,
  floorMs: 5 * MS_PER_MINUTE,
  settleGraceMs: 5 * MS_PER_MINUTE,
  writeBufferFactor: 1.5,
};

export { PUSH_SYNC_DEADLINE_POLICY };
export type { PushSyncDeadlinePolicy };
