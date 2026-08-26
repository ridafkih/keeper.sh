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
const DISCONNECT_TIMEOUT_MS = 5000;
const LIVE_STATES = ["active", "degraded", "registering"];
const TEARDOWN_STATES = [...LIVE_STATES, "failed"];

interface DeregisterPushChannelsDependencies {
  createRegistrarContext: (channel: StoredPushChannel) => Promise<RegistrarContext>;
  listLiveChannels: (scopeId: string) => Promise<StoredPushChannel[]>;
  observe: (fields: Record<string, unknown>) => void;
  recordError: (error: unknown, slug: string) => void;
  resolveRegistrar: (provider: string) => SourcePushRegistrar | null;
  webhookConfigured: boolean;
}

const stopChannel = async (
  channel: StoredPushChannel,
  dependencies: DeregisterPushChannelsDependencies,
): Promise<boolean> => {
  const registrar = dependencies.resolveRegistrar(channel.provider);
  if (!registrar || channel.providerChannelId === null) {
    return false;
  }

  try {
    await registrar.deregister(channel, await dependencies.createRegistrarContext(channel));
    return true;
  } catch (error) {
    dependencies.recordError(error, DEREGISTRATION_FAILED_SLUG);
    return false;
  }
};

const runDeregisterPushChannels = async (
  scopeId: string,
  dependencies: DeregisterPushChannelsDependencies,
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

  let stopped = 0;
  for (const channel of channels) {
    if (await stopChannel(channel, dependencies)) {
      stopped += 1;
    }
  }

  dependencies.observe({
    "push_channel.disconnect_deregistered_count": stopped,
    "push_channel.disconnect_live_count": channels.length,
  });

  return stopped;
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
    observe: (fields) => {
      widelog.setFields(fields);
    },
    recordError: (error, slug) => {
      widelog.errorFields(error, { retriable: false, slug });
    },
    resolveRegistrar: resolvePushRegistrar,
    webhookConfigured: webhookConfig !== null,
  });
};

const deregisterAccountPushChannels = async (accountId: string): Promise<number> =>
  await deregisterPushChannelsWithin(accountId, "accountId", LIVE_STATES);

const deregisterCalendarPushChannels = async (calendarId: string): Promise<number> =>
  await deregisterPushChannelsWithin(calendarId, "calendarId", LIVE_STATES);

const deregisterUserPushChannels = async (userId: string): Promise<number> =>
  await deregisterPushChannelsWithin(userId, "userId", TEARDOWN_STATES);

const runDeregisterAccountPushChannels = runDeregisterPushChannels;
const runDeregisterUserPushChannels = runDeregisterPushChannels;

export {
  DEREGISTRATION_FAILED_SLUG,
  deregisterAccountPushChannels,
  deregisterCalendarPushChannels,
  deregisterUserPushChannels,
  runDeregisterAccountPushChannels,
  runDeregisterPushChannels,
  runDeregisterUserPushChannels,
};
export type { DeregisterPushChannelsDependencies };
