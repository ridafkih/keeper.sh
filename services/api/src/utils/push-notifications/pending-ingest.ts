import { and, arrayContains, eq } from "drizzle-orm";
import { calendarPushChannelsTable, calendarsTable } from "@keeper.sh/database/schema";
import {
  buildUnknownChannelKey,
  PENDING_CORRELATION_KEY,
  PENDING_INGEST_KEY,
  PENDING_REWAKE_KEY,
  signalPendingCalendars,
  resolveAffectedCalendarIds,
  resolvePushRegistrar,
  toPushChannelState,
  verifyPushSecret,
} from "@keeper.sh/calendar";
import type { StoredPushChannel, WebhookConfig } from "@keeper.sh/calendar";
import { spawnBackgroundJob } from "@/utils/background-task";
import { claimPushAdmission } from "@/utils/push-admission";
import { widelog } from "@/utils/logging";
import type { PushWebhookDependencies } from "./handle-webhook";

const DELIVERY_TTL_SECONDS = 900;

const resolveConfiguredPublicUrl = (
  webhookConfig: WebhookConfig | null,
  publicUrl: string | undefined,
): string | null => {
  if (webhookConfig === null || !publicUrl) {
    return null;
  }
  return publicUrl;
};

const createPushWebhookDependencies = async (
  provider: string,
): Promise<PushWebhookDependencies> => {
  const { database, env, redis, webhookConfig } = await import("@/context");

  const readChannel = async (
    channelKey: string,
  ): Promise<StoredPushChannel | null> => {
    const [row] = await database
      .select()
      .from(calendarPushChannelsTable)
      .where(and(
        eq(calendarPushChannelsTable.provider, provider),
        eq(calendarPushChannelsTable.providerChannelId, channelKey),
      ))
      .limit(1);

    if (!row) {
      return null;
    }

    return { ...row, state: toPushChannelState(row.state) };
  };

  return {
    claimDelivery: async (deliveryKey) => {
      const claimed = await redis.set(
        `webhook:seen:${deliveryKey}`,
        "1",
        "EX",
        DELIVERY_TTL_SECONDS,
        "NX",
      );
      return claimed !== null;
    },
    claimPushAdmission: (input) => claimPushAdmission(redis, input),
    findChannel: (_provider, channelKey) => readChannel(channelKey),
    generateCorrelationId: () => crypto.randomUUID(),
    isUnknownChannelCached: async (cachedProvider, channelKey) =>
      await redis.get(buildUnknownChannelKey(cachedProvider, channelKey)) !== null,
    markChannelRemoved: async (channelId) => {
      await database
        .update(calendarPushChannelsTable)
        .set({ state: "removed" })
        .where(eq(calendarPushChannelsTable.id, channelId));
    },
    markPendingIngest: async (calendarIds, correlationId) => {
      // The id lands first so the drain never sees a member without one.
      await redis.hset(
        PENDING_CORRELATION_KEY,
        ...calendarIds.flatMap((calendarId) => [calendarId, correlationId]),
      );
      await Promise.all(calendarIds.map((calendarId) =>
        redis.hincrby(PENDING_REWAKE_KEY, calendarId, 1)));
      const now = Date.now();
      await redis.zadd(
        PENDING_INGEST_KEY,
        "LT",
        ...calendarIds.flatMap((calendarId) => [now, calendarId]),
      );
    },
    markReauthorizeRequested: async (channelId) => {
      await database
        .update(calendarPushChannelsTable)
        .set({ reauthorizeRequestedAt: new Date() })
        .where(eq(calendarPushChannelsTable.id, channelId));
    },
    observe: (fields) => {
      widelog.setFields(fields);
    },
    recordError: (error, slug) => {
      widelog.errorFields(error, { retriable: true, slug });
    },
    recordNotificationReceived: (channelId) => {
      spawnBackgroundJob(
        "push-notification-received",
        { "webhook.channel_id": channelId },
        async () => {
          await database
            .update(calendarPushChannelsTable)
            .set({ lastNotificationAt: new Date() })
            .where(eq(calendarPushChannelsTable.id, channelId));
        },
      );
    },
    recordVerified: async (channelId) => {
      const now = new Date();
      await database
        .update(calendarPushChannelsTable)
        .set({ lastNotificationAt: now, verifiedAt: now })
        .where(eq(calendarPushChannelsTable.id, channelId));
    },
    rememberUnknownChannel: async (cachedProvider, channelKey, ttlSeconds) => {
      await redis.set(
        buildUnknownChannelKey(cachedProvider, channelKey),
        "1",
        "EX",
        ttlSeconds,
        "NX",
      );
    },
    resolveAffectedCalendarIds: (channel) => {
      const fanOut = resolvePushRegistrar(channel.provider)?.resolveAffectedCalendarIds
        ?? resolveAffectedCalendarIds;
      return fanOut(channel, {
        listAccountCalendars: (accountId) => database
          .select({
            capabilities: calendarsTable.capabilities,
            disabled: calendarsTable.disabled,
            id: calendarsTable.id,
          })
          .from(calendarsTable)
          .where(and(
            eq(calendarsTable.accountId, accountId),
            eq(calendarsTable.disabled, false),
            arrayContains(calendarsTable.capabilities, ["pull"]),
          )),
      });
    },
    signalPendingIngest: (calendarIds) => signalPendingCalendars(redis, calendarIds),
    verifySecret: verifyPushSecret,
    webhookPublicUrl: resolveConfiguredPublicUrl(webhookConfig, env.WEBHOOK_PUBLIC_URL),
  };
};

export { createPushWebhookDependencies };
