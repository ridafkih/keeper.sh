import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import type { Plan } from "@keeper.sh/data-schemas";

const PUSH_SYNC_QUEUE_NAME = "push-sync-v2";
const USER_TIMEOUT_MS = 300_000;

type PushSyncTrigger = "cron" | "push";

/*
 * `trigger` and `webhookReceivedAt` reflect the FIRST enqueue: the stable jobId makes
 * addBulk a no-op when a job with that id already exists, exactly like BullMQ's own
 * job.timestamp, so the fields stay mutually consistent.
 *
 * `webhookReceivedAt` is absent for a cron sync, which has no originating webhook. A zero
 * would read as a real measurement and drag every latency quantile to the floor.
 */
interface PushSyncJobPayload {
  calendarId: string;
  userId: string;
  plan: Plan;
  correlationId: string;
  trigger?: PushSyncTrigger;
  webhookReceivedAt?: number;
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
export type { PushSyncJobPayload, PushSyncJobResult, PushSyncTrigger };
