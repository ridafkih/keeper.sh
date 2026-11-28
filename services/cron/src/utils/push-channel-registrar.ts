import { createRegistrarContextFactory } from "@keeper.sh/calendar";
import { database, refreshLockRedis, refreshLockStore, webhookConfig } from "@/context";
import { keyring } from "@/utils/keyring";
import env from "@/env";

const createRegistrarContext = createRegistrarContextFactory({
  database,
  googleClientId: env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  googleProjectRequestsPerMinute: env.GOOGLE_PROJECT_REQUESTS_PER_MINUTE,
  keyring,
  microsoftClientId: env.MICROSOFT_CLIENT_ID,
  microsoftClientSecret: env.MICROSOFT_CLIENT_SECRET,
  rateLimiterRedis: refreshLockRedis,
  refreshLockStore,
  webhookConfig,
});

export { createRegistrarContext };
