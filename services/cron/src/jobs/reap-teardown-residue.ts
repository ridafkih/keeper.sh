import type { CronOptions } from "cronbake";
import {
  createGoogleTokenRefresher,
  createMicrosoftTokenRefresher,
  createTeardownResidueReaper,
  createTeardownResidueStore,
  ensureValidToken,
  resolvePushRegistrar,
  revokeGoogleGrant,
} from "@keeper.sh/calendar";
import type {
  RegistrarContext,
  TeardownResidueRecord,
  TokenRefresher,
  TokenState,
  WebhookConfig,
} from "@keeper.sh/calendar";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";

const RESIDUE_STOP_TIMEOUT_MS = 5000;
const POLAR_RESOURCE_NOT_FOUND = "ResourceNotFound";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isPolarCustomerAlreadyGone = (error: unknown): boolean =>
  isRecord(error) && error.error === POLAR_RESOURCE_NOT_FOUND;

const resolveNotificationUrl = (provider: string, config: WebhookConfig): string => {
  if (provider === "google") {
    return config.googleCallbackUrl;
  }

  if (provider === "outlook") {
    return config.outlookCallbackUrl;
  }

  throw new Error(`No push notification url is defined for provider ${provider}`);
};

const resolveTokenRefresher = (
  provider: string,
  clientCredentials: {
    googleClientId?: string;
    googleClientSecret?: string;
    microsoftClientId?: string;
    microsoftClientSecret?: string;
  },
): TokenRefresher | null => {
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

const resolveResidueAccessToken = async (
  record: TeardownResidueRecord,
  provider: string,
): Promise<string> => {
  const { default: environment } = await import("@/env");
  const { credential } = record;

  if (!credential) {
    throw new Error(
      `Push channel residue ${record.id} for user ${record.userId} carries no credential, so the provider cannot be dialed`,
    );
  }

  const refresher = resolveTokenRefresher(provider, {
    googleClientId: environment.GOOGLE_CLIENT_ID,
    googleClientSecret: environment.GOOGLE_CLIENT_SECRET,
    microsoftClientId: environment.MICROSOFT_CLIENT_ID,
    microsoftClientSecret: environment.MICROSOFT_CLIENT_SECRET,
  });

  if (!refresher || credential.refreshToken === null || credential.expiresAt === null) {
    return credential.accessToken;
  }

  const tokenState: TokenState = {
    accessToken: credential.accessToken,
    accessTokenExpiresAt: credential.expiresAt,
    refreshToken: credential.refreshToken,
  };

  await ensureValidToken(tokenState, refresher);

  return tokenState.accessToken;
};

const createResidueRegistrarContext = async (
  record: TeardownResidueRecord,
): Promise<RegistrarContext> => {
  const { webhookConfig } = await import("@/context");

  if (webhookConfig === null) {
    throw new Error(
      "Teardown residue repair requires WEBHOOK_PUBLIC_URL to be configured",
    );
  }

  if (!record.provider) {
    throw new Error(
      `Push channel residue ${record.id} for user ${record.userId} names no provider`,
    );
  }

  const now = new Date();

  return {
    accessToken: await resolveResidueAccessToken(record, record.provider),
    channelId: record.providerChannelId ?? null,
    fetchImpl: globalThis.fetch,
    notificationUrl: resolveNotificationUrl(record.provider, webhookConfig),
    now,
    requestedExpiresAt: now,
    signal: AbortSignal.timeout(RESIDUE_STOP_TIMEOUT_MS),
  };
};

const deletePolarCustomer = async (externalId: string): Promise<void> => {
  const { polarClient } = await import("@/context");

  if (polarClient === null) {
    throw new Error(
      `Polar residue for ${externalId} cannot be cleared: this deployment has no Polar client`,
    );
  }

  try {
    await polarClient.customers.deleteExternal({ externalId });
  } catch (error) {
    if (isPolarCustomerAlreadyGone(error)) {
      return;
    }

    throw error;
  }
};

const revokeOAuthGrant = async (
  record: TeardownResidueRecord,
  token: string,
): Promise<void> => {
  if (record.provider !== "google") {
    throw new Error(
      `OAuth grant residue ${record.id} for user ${record.userId} names provider ${record.provider ?? "none"}, which has no revocation endpoint wired`,
    );
  }

  const outcome = await revokeGoogleGrant(token, { fetchImpl: globalThis.fetch });

  if (!outcome.revoked) {
    throw new Error(
      `Google refused to revoke the grant behind residue ${record.id} `
        + `(${outcome.status}): ${outcome.body}`,
    );
  }
};

const countSurvivingAccountLinks = async (
  record: TeardownResidueRecord,
): Promise<number> => {
  const { provider, accountEmail } = record;

  if (!provider || !accountEmail) {
    throw new Error(
      `OAuth grant residue ${record.id} for user ${record.userId} names no provider account, so co-holders of the grant cannot be counted`,
    );
  }

  const { database } = await import("@/context");
  const { oauthCredentialsTable } = await import("@keeper.sh/database/schema");
  const { and, count, eq } = await import("drizzle-orm");

  const [row] = await database
    .select({ surviving: count() })
    .from(oauthCredentialsTable)
    .where(
      and(
        eq(oauthCredentialsTable.provider, provider),
        eq(oauthCredentialsTable.email, accountEmail),
      ),
    );

  if (!row) {
    throw new Error(
      `Counting surviving links to ${provider} account behind residue ${record.id} returned no row`,
    );
  }

  return row.surviving;
};

const createDefaultReaper = async () => {
  const { database } = await import("@/context");
  const { default: environment } = await import("@/env");

  if (!environment.ENCRYPTION_KEY) {
    throw new Error(
      "Teardown residue repair requires ENCRYPTION_KEY to read the credential it stored",
    );
  }

  return createTeardownResidueReaper({
    countSurvivingAccountLinks,
    createRegistrarContext: createResidueRegistrarContext,
    deletePolarCustomer,
    now: () => new Date(),
    observe: (fields) => {
      widelog.setFields(fields);
    },
    recordError: (error, slug) => {
      widelog.errorFields(error, { retriable: true, slug });
    },
    residue: createTeardownResidueStore({
      database,
      encryptionKey: environment.ENCRYPTION_KEY,
      now: () => new Date(),
    }),
    resolveRegistrar: resolvePushRegistrar,
    revokeOAuthGrant,
  });
};

export default withCronWideEvent({
  async callback() {
    const reap = await createDefaultReaper();
    await reap();
  },
  cron: "@every_5_minutes",
  name: import.meta.file,
  overrunProtection: true,
}) satisfies CronOptions;
