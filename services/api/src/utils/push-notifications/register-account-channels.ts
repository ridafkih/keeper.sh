import {
  createManagePushChannelsDependencies,
  createRegistrarContextFactory,
  runManagePushChannels,
} from "@keeper.sh/calendar";
import { widelog } from "@/utils/logging";

const REGISTRATION_FAILED_SLUG = "webhook-registration-failed";

/*
 * The cron sweep is otherwise the only thing that registers a channel, so a freshly
 * connected account has no realtime until the next tick — the first minutes after
 * connecting, which is exactly when someone tests whether the product does what it says.
 * This runs the same sweep narrowed to the new account. Failing here must never fail the
 * connection: the sweep remains the safety net and will pick the account up regardless.
 */
const registerAccountPushChannels = async (accountId: string): Promise<void> => {
  const { database, env, premiumService, redis, refreshLockStore, webhookConfig } = await import(
    "@/context",
  );

  if (webhookConfig === null) {
    return;
  }

  const dependencies = createManagePushChannelsDependencies({
    createRegistrarContext: createRegistrarContextFactory({
      database,
      googleClientId: env.GOOGLE_CLIENT_ID,
      googleClientSecret: env.GOOGLE_CLIENT_SECRET,
      microsoftClientId: env.MICROSOFT_CLIENT_ID,
      microsoftClientSecret: env.MICROSOFT_CLIENT_SECRET,
      rateLimiterRedis: redis,
      refreshLockStore,
      webhookConfig,
    }),
    database,
    locks: refreshLockStore,
    negativeCache: redis,
    observe: (fields) => {
      widelog.setFields(fields);
    },
    onlyAccountId: accountId,
    recordError: (error, slug) => {
      widelog.errorFields(error, { retriable: true, slug });
    },
    resolvePlan: (userId) => premiumService.getUserPlan(userId),
    webhookPublicUrl: env.WEBHOOK_PUBLIC_URL ?? null,
  });

  try {
    await runManagePushChannels(dependencies);
  } catch (error) {
    widelog.errorFields(error, { retriable: true, slug: REGISTRATION_FAILED_SLUG });
  }
};

export { REGISTRATION_FAILED_SLUG, registerAccountPushChannels };
