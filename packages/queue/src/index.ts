import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import type { Plan } from "@keeper.sh/data-schemas";

const PUSH_SYNC_QUEUE_NAME = "push-sync";
const USER_TIMEOUT_MS = 300_000;

interface PushSyncJobPayload {
  userId: string;
  plan: Plan;
}

interface PushSyncJobResult {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
  errors: string[];
}

const createPushSyncQueue = (connection: ConnectionOptions): Queue<PushSyncJobPayload, PushSyncJobResult> =>
  new Queue(PUSH_SYNC_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 1,
    },
  });

export { PUSH_SYNC_QUEUE_NAME, USER_TIMEOUT_MS, createPushSyncQueue };
export type { PushSyncJobPayload, PushSyncJobResult };
