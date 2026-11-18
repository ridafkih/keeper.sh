import { createRegistrarContextFactory } from "@keeper.sh/calendar";
import { database, refreshLockRedis, refreshLockStore, webhookConfig } from "@/context";
import env from "@/env";
import { microsoftCredentials } from "@/microsoft-credentials";

const createRegistrarContext = createRegistrarContextFactory({
  database,
  googleClientId: env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  googleProjectRequestsPerMinute: env.GOOGLE_PROJECT_REQUESTS_PER_MINUTE,
  microsoftCredentials,
  rateLimiterRedis: refreshLockRedis,
  refreshLockStore,
  webhookConfig,
});

export { createRegistrarContext };
