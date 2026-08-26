import { and, eq, inArray } from "drizzle-orm";
import {
  createCoordinatedRefresher,
  createGoogleTokenRefresher,
  createMicrosoftTokenRefresher,
  ensureValidToken,
  resolvePushRegistrar,
  toPushChannelState,
} from "@keeper.sh/calendar";
import type {
  RegistrarContext,
  SourcePushRegistrar,
  StoredPushChannel,
  TokenState,
  WebhookConfig,
} from "@keeper.sh/calendar";
import {
  calendarAccountsTable,
  calendarPushChannelsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { widelog } from "@/utils/logging";

const DEREGISTRATION_FAILED_SLUG = "webhook-deregistration-failed";
const RESTATE_FAILED_SLUG = "push-channel-restate-failed";
const STOPPED_STATE = "removed";
const DISCONNECT_TIMEOUT_MS = 5000;
const DISCONNECT_CONCURRENCY = 8;
const LIVE_STATES = ["active", "degraded", "registering"];
const TEARDOWN_STATES = [...LIVE_STATES, "failed"];

interface DeregisterPushChannelsDependencies {
  createRegistrarContext: (channel: StoredPushChannel) => Promise<RegistrarContext>;
  listLiveChannels: (scopeId: string) => Promise<StoredPushChannel[]>;
  markChannelsStopped?: (channelIds: string[]) => Promise<void>;
  observe: (fields: Record<string, unknown>) => void;
  recordError: (error: unknown, slug: string) => void;
  resolveRegistrar: (provider: string) => SourcePushRegistrar | null;
  webhookConfigured: boolean;
}

interface AbandonedPushChannel {
  id: string;
  provider: string;
  providerChannelId: string;
}

interface PreparedStop {
  channel: StoredPushChannel;
  context: RegistrarContext;
  registrar: SourcePushRegistrar;
}

const combineSignals = (signals: AbortSignal[]): AbortSignal[] => {
  if (signals.length < 2) {
    return signals;
  }
  return [AbortSignal.any(signals)];
};

const resolveStopSignals = (
  prepared: PreparedStop,
  signal: AbortSignal | null,
): AbortSignal[] => {
  const candidates = [signal, prepared.context.signal ?? null];

  return candidates.filter((candidate): candidate is AbortSignal => candidate !== null);
};

const prepareStops = async (
  channels: StoredPushChannel[],
  dependencies: DeregisterPushChannelsDependencies,
  signal: AbortSignal | null,
): Promise<PreparedStop[]> => {
  const queued = [...channels];
  const prepared: PreparedStop[] = [];

  const workers = Array.from(
    { length: Math.min(DISCONNECT_CONCURRENCY, queued.length) },
    async () => {
      for (let channel = queued.shift(); channel; channel = queued.shift()) {
        if (signal?.aborted) {
          return;
        }

        const registrar = dependencies.resolveRegistrar(channel.provider);
        if (!registrar || channel.providerChannelId === null) {
          continue;
        }

        try {
          const context = await dependencies.createRegistrarContext(channel);
          prepared.push({ channel, context, registrar });
        } catch (error) {
          dependencies.recordError(error, DEREGISTRATION_FAILED_SLUG);
        }
      }
    },
  );

  await Promise.all(workers);

  return prepared;
};

const stopPreparedChannel = async (
  prepared: PreparedStop,
  dependencies: DeregisterPushChannelsDependencies,
  signal: AbortSignal | null,
): Promise<boolean> => {
  const [effectiveSignal] = combineSignals(resolveStopSignals(prepared, signal));

  if (effectiveSignal?.aborted) {
    return false;
  }

  try {
    await prepared.registrar.deregister(prepared.channel, {
      ...prepared.context,
      ...(effectiveSignal && { signal: effectiveSignal }),
    });
    return true;
  } catch (error) {
    dependencies.recordError(error, DEREGISTRATION_FAILED_SLUG);
    return false;
  }
};

const describeAbandoned = (
  channels: StoredPushChannel[],
  stoppedChannelIds: string[],
): AbandonedPushChannel[] => {
  const stopped = new Set(stoppedChannelIds);

  return channels
    .filter((channel) => channel.providerChannelId !== null && !stopped.has(channel.id))
    .map((channel) => ({
      id: channel.id,
      provider: channel.provider,
      providerChannelId: String(channel.providerChannelId),
    }));
};

const restateStoppedChannels = async (
  channelIds: string[],
  dependencies: DeregisterPushChannelsDependencies,
): Promise<number> => {
  if (channelIds.length === 0) {
    return 0;
  }

  const { markChannelsStopped } = dependencies;
  if (!markChannelsStopped) {
    dependencies.recordError(
      new Error(
        `Push channels ${channelIds.join(", ")} were stopped at the provider but no channel writer was supplied to restate their rows`,
      ),
      RESTATE_FAILED_SLUG,
    );
    return 0;
  }

  try {
    await markChannelsStopped(channelIds);
    return channelIds.length;
  } catch (error) {
    dependencies.recordError(error, RESTATE_FAILED_SLUG);
    return 0;
  }
};

const runDeregisterPushChannels = async (
  scopeId: string,
  dependencies: DeregisterPushChannelsDependencies,
  signal: AbortSignal | null = null,
): Promise<number> => {
  if (!dependencies.webhookConfigured) {
    return 0;
  }

  let channels: StoredPushChannel[] = [];
  try {
    channels = await dependencies.listLiveChannels(scopeId);
  } catch (error) {
    dependencies.recordError(error, DEREGISTRATION_FAILED_SLUG);
    return 0;
  }

  const pending = await prepareStops(channels, dependencies, signal);
  const stoppedChannelIds: string[] = [];

  const workers = Array.from(
    { length: Math.min(DISCONNECT_CONCURRENCY, pending.length) },
    async () => {
      for (let prepared = pending.shift(); prepared; prepared = pending.shift()) {
        if (signal?.aborted) {
          return;
        }

        if (await stopPreparedChannel(prepared, dependencies, signal)) {
          stoppedChannelIds.push(prepared.channel.id);
        }
      }
    },
  );

  await Promise.all(workers);

  const restated = await restateStoppedChannels(stoppedChannelIds, dependencies);
  const abandoned = describeAbandoned(channels, stoppedChannelIds);

  dependencies.observe({
    "push_channel.disconnect_abandoned": abandoned,
    "push_channel.disconnect_abandoned_count": abandoned.length,
    "push_channel.disconnect_deregistered_count": stoppedChannelIds.length,
    "push_channel.disconnect_live_count": channels.length,
    "push_channel.disconnect_restated_count": restated,
  });

  return stoppedChannelIds.length;
};

const resolveTokenRefresher = (
  provider: string,
  clientCredentials: {
    googleClientId?: string;
    googleClientSecret?: string;
    microsoftClientId?: string;
    microsoftClientSecret?: string;
  },
) => {
  if (
    provider === "google"
    && clientCredentials.googleClientId
    && clientCredentials.googleClientSecret
  ) {
    return createGoogleTokenRefresher({
      clientId: clientCredentials.googleClientId,
      clientSecret: clientCredentials.googleClientSecret,
    });
  }

  if (
    provider === "outlook"
    && clientCredentials.microsoftClientId
    && clientCredentials.microsoftClientSecret
  ) {
    return createMicrosoftTokenRefresher({
      clientId: clientCredentials.microsoftClientId,
      clientSecret: clientCredentials.microsoftClientSecret,
    });
  }

  return null;
};

const resolveNotificationUrl = (provider: string, config: WebhookConfig): string => {
  if (provider === "google") {
    return config.googleCallbackUrl;
  }
  if (provider === "outlook") {
    return config.outlookCallbackUrl;
  }
  throw new Error(`No push notification url is defined for provider ${provider}`);
};

const deregisterPushChannelsWithin = async (
  scopeId: string,
  scopeColumn: "accountId" | "calendarId" | "userId",
  states: string[],
  signal: AbortSignal | null,
): Promise<number> => {
  const { database, env, refreshLockStore, webhookConfig } = await import("@/context");

  return await runDeregisterPushChannels(scopeId, {
    createRegistrarContext: async (channel) => {
      if (webhookConfig === null) {
        throw new Error(
          "Push channel deregistration requires WEBHOOK_PUBLIC_URL to be configured",
        );
      }

      const [credentials] = await database
        .select({
          accessToken: oauthCredentialsTable.accessToken,
          calendarAccountId: calendarAccountsTable.id,
          expiresAt: oauthCredentialsTable.expiresAt,
          oauthCredentialId: oauthCredentialsTable.id,
          refreshToken: oauthCredentialsTable.refreshToken,
        })
        .from(calendarAccountsTable)
        .innerJoin(
          oauthCredentialsTable,
          eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
        )
        .where(eq(calendarAccountsTable.id, channel.accountId))
        .limit(1);

      if (!credentials) {
        throw new Error(
          `No OAuth credentials found for push channel account ${channel.accountId}`,
        );
      }

      const tokenState: TokenState = {
        accessToken: credentials.accessToken,
        accessTokenExpiresAt: credentials.expiresAt,
        refreshToken: credentials.refreshToken,
      };

      const rawRefresh = resolveTokenRefresher(channel.provider, {
        googleClientId: env.GOOGLE_CLIENT_ID,
        googleClientSecret: env.GOOGLE_CLIENT_SECRET,
        microsoftClientId: env.MICROSOFT_CLIENT_ID,
        microsoftClientSecret: env.MICROSOFT_CLIENT_SECRET,
      });
      if (rawRefresh) {
        await ensureValidToken(tokenState, createCoordinatedRefresher({
          calendarAccountId: credentials.calendarAccountId,
          database,
          oauthCredentialId: credentials.oauthCredentialId,
          rawRefresh,
          refreshLockStore,
        }));
      }

      return {
        accessToken: tokenState.accessToken,
        channelId: channel.providerChannelId,
        fetchImpl: globalThis.fetch,
        notificationUrl: resolveNotificationUrl(channel.provider, webhookConfig),
        now: new Date(),
        requestedExpiresAt: new Date(),
        signal: AbortSignal.timeout(DISCONNECT_TIMEOUT_MS),
      };
    },
    listLiveChannels: async (scope) => {
      const rows = await database
        .select()
        .from(calendarPushChannelsTable)
        .where(and(
          eq(calendarPushChannelsTable[scopeColumn], scope),
          inArray(calendarPushChannelsTable.state, states),
        ));
      return rows.map((row) => ({ ...row, state: toPushChannelState(row.state) }));
    },
    markChannelsStopped: async (channelIds) => {
      await database
        .update(calendarPushChannelsTable)
        .set({
          expiresAt: null,
          lastNotificationAt: null,
          state: STOPPED_STATE,
          verifiedAt: null,
        })
        .where(and(
          eq(calendarPushChannelsTable[scopeColumn], scopeId),
          inArray(calendarPushChannelsTable.id, channelIds),
        ));
    },
    observe: (fields) => {
      widelog.setFields(fields);
    },
    recordError: (error, slug) => {
      widelog.errorFields(error, { retriable: false, slug });
    },
    resolveRegistrar: resolvePushRegistrar,
    webhookConfigured: webhookConfig !== null,
  }, signal);
};

const deregisterAccountPushChannels = async (accountId: string): Promise<number> =>
  await deregisterPushChannelsWithin(accountId, "accountId", LIVE_STATES, null);

const deregisterCalendarPushChannels = async (calendarId: string): Promise<number> =>
  await deregisterPushChannelsWithin(calendarId, "calendarId", LIVE_STATES, null);

const deregisterUserPushChannels = async (
  userId: string,
  signal: AbortSignal | null = null,
): Promise<number> =>
  await deregisterPushChannelsWithin(userId, "userId", TEARDOWN_STATES, signal);

const runDeregisterAccountPushChannels = runDeregisterPushChannels;
const runDeregisterUserPushChannels = runDeregisterPushChannels;

export {
  DEREGISTRATION_FAILED_SLUG,
  RESTATE_FAILED_SLUG,
  deregisterAccountPushChannels,
  deregisterCalendarPushChannels,
  deregisterUserPushChannels,
  runDeregisterAccountPushChannels,
  runDeregisterPushChannels,
  runDeregisterUserPushChannels,
};
export type { AbandonedPushChannel, DeregisterPushChannelsDependencies };
