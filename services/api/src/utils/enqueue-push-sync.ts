import { createPushSyncQueue } from "@keeper.sh/queue";
import type { Plan } from "@keeper.sh/data-schemas";

const enqueuePushSync = async (userId: string, plan: Plan): Promise<void> => {
  const { env } = await import("@/context");
  const correlationId = crypto.randomUUID();

  const queue = createPushSyncQueue({ url: env.REDIS_URL, maxRetriesPerRequest: null });

  try {
    await queue.add(`sync-${userId}`, { userId, plan, correlationId });
  } finally {
    await queue.close();
  }
};

export { enqueuePushSync };
