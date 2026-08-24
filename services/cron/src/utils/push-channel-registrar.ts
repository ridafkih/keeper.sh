import { createRegistrarContextFactory } from "@keeper.sh/calendar";
import { database, refreshLockRedis, refreshLockStore, webhookConfig } from "@/context";
import env from "@/env";

const createRegistrarContext = createRegistrarContextFactory({
  database,
  googleClientId: env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  microsoftClientId: env.MICROSOFT_CLIENT_ID,
  microsoftClientSecret: env.MICROSOFT_CLIENT_SECRET,
  rateLimiterRedis: refreshLockRedis,
  refreshLockStore,
  webhookConfig,
});

export { createRegistrarContext };
