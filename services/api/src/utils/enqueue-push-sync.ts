import { createPushSyncQueue } from "@keeper.sh/queue";
import type { PushSyncJobPayload } from "@keeper.sh/queue";
import type { Plan } from "@keeper.sh/data-schemas";

interface PushSyncQueue {
  add: (name: string, data: PushSyncJobPayload) => Promise<unknown>;
  close: () => Promise<void>;
}

interface EnqueuePushSyncDependencies {
  createQueue: () => PushSyncQueue;
  generateCorrelationId: () => string;
}

const runEnqueuePushSync = async (
  userId: string,
  plan: Plan,
  dependencies: EnqueuePushSyncDependencies,
): Promise<void> => {
  const correlationId = dependencies.generateCorrelationId();
  const queue = dependencies.createQueue();

  try {
    await queue.add(`sync-${userId}`, { userId, plan, correlationId });
  } finally {
    await queue.close();
  }
};

const enqueuePushSync = async (userId: string, plan: Plan): Promise<void> => {
  const { env } = await import("@/context");

  return runEnqueuePushSync(userId, plan, {
    createQueue: () => createPushSyncQueue({ url: env.REDIS_URL, maxRetriesPerRequest: null }),
    generateCorrelationId: () => crypto.randomUUID(),
  });
};

export { enqueuePushSync, runEnqueuePushSync };
export type { EnqueuePushSyncDependencies, PushSyncQueue };
