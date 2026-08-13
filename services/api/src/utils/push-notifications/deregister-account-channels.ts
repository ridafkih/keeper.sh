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

interface DeregisterAccountPushChannelsDependencies {
  createRegistrarContext: (channel: StoredPushChannel) => Promise<RegistrarContext>;
  listLiveChannels: (accountId: string) => Promise<StoredPushChannel[]>;
  observe: (fields: Record<string, unknown>) => void;
  recordError: (error: unknown, slug: string) => void;
  resolveRegistrar: (provider: string) => SourcePushRegistrar | null;
  webhookConfigured: boolean;
}

const stopChannel = async (
  channel: StoredPushChannel,
  dependencies: DeregisterAccountPushChannelsDependencies,
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

const runDeregisterAccountPushChannels = async (
  accountId: string,
  dependencies: DeregisterAccountPushChannelsDependencies,
): Promise<number> => {
  if (!dependencies.webhookConfigured) {
    return 0;
  }

  let channels: StoredPushChannel[] = [];
  try {
    channels = await dependencies.listLiveChannels(accountId);
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

const deregisterAccountPushChannels = async (accountId: string): Promise<number> => {
  const { database, env, refreshLockStore, webhookConfig } = await import("@/context");

  return await runDeregisterAccountPushChannels(accountId, {
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
    listLiveChannels: async (ownerAccountId) => {
      const rows = await database
        .select()
        .from(calendarPushChannelsTable)
        .where(and(
          eq(calendarPushChannelsTable.accountId, ownerAccountId),
          inArray(calendarPushChannelsTable.state, LIVE_STATES),
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

export {
  DEREGISTRATION_FAILED_SLUG,
  deregisterAccountPushChannels,
  runDeregisterAccountPushChannels,
};
export type { DeregisterAccountPushChannelsDependencies };
