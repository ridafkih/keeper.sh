import { Queue } from "bullmq";
import type { ConnectionOptions, Job, JobsOptions } from "bullmq";
import { SpanKind, captureTraceContext, withSpan } from "@keeper.sh/otelemetry/tracing";
import type { TraceCarrier } from "@keeper.sh/otelemetry/tracing";
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
  traceContext?: TraceCarrier;
}

interface PushSyncJobResult {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
  errors: string[];
  continuationRequested?: boolean;
}

const resolvePushSyncJobId = (userId: string, calendarId: string): string =>
  `sync-${userId}-${calendarId}`;

interface PushSyncBulkJob {
  name: string;
  data: PushSyncJobPayload;
  opts?: JobsOptions;
}

const MESSAGING_ATTRIBUTES = {
  "messaging.system": "bullmq",
  "messaging.destination.name": PUSH_SYNC_QUEUE_NAME,
  "messaging.operation.type": "send",
};

const withTraceContext = (data: PushSyncJobPayload): PushSyncJobPayload => ({
  ...data,
  traceContext: captureTraceContext(),
});

class PushSyncQueue extends Queue<PushSyncJobPayload, PushSyncJobResult> {
  override add(
    name: string,
    data: PushSyncJobPayload,
    opts?: JobsOptions,
  ): Promise<Job<PushSyncJobPayload, PushSyncJobResult>> {
    return withSpan(
      `send ${PUSH_SYNC_QUEUE_NAME}`,
      { kind: SpanKind.PRODUCER, attributes: { ...MESSAGING_ATTRIBUTES, "messaging.batch.message_count": 1 } },
      () => super.add(name, withTraceContext(data), opts),
    );
  }

  override addBulk(jobs: PushSyncBulkJob[]): Promise<Job<PushSyncJobPayload, PushSyncJobResult>[]> {
    return withSpan(
      `send ${PUSH_SYNC_QUEUE_NAME}`,
      { kind: SpanKind.PRODUCER, attributes: { ...MESSAGING_ATTRIBUTES, "messaging.batch.message_count": jobs.length } },
      () => super.addBulk(jobs.map((job) => ({ ...job, data: withTraceContext(job.data) }))),
    );
  }
}

const createPushSyncQueue = (connection: ConnectionOptions): PushSyncQueue =>
  new PushSyncQueue(PUSH_SYNC_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 1,
    },
  });

export { PUSH_SYNC_QUEUE_NAME, USER_TIMEOUT_MS, PushSyncQueue, createPushSyncQueue, resolvePushSyncJobId };
export type { PushSyncJobPayload, PushSyncJobResult, PushSyncTrigger };
