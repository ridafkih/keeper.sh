import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import type { Plan } from "@keeper.sh/data-schemas";

const PUSH_SYNC_QUEUE_NAME = "push-sync-v2";
const USER_TIMEOUT_MS = 300_000;

type PushSyncTrigger = "cron" | "push";

/*
 * `trigger` reflects the FIRST enqueue: the stable jobId makes addBulk a no-op when
 * a job with that id already exists, exactly like BullMQ's own job.timestamp, so the
 * two fields stay mutually consistent.
 */
interface PushSyncJobPayload {
  calendarId: string;
  userId: string;
  plan: Plan;
  correlationId: string;
  trigger?: PushSyncTrigger;
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
export { runEnqueuePushSync } from "./enqueue-push-sync";
export type { PushSyncJobPayload, PushSyncJobResult, PushSyncTrigger };
export type {
  EnqueuePushSyncDependencies,
  PushSyncJobOptions,
  PushSyncQueue,
} from "./enqueue-push-sync";
