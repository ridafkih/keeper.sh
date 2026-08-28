import type { CronOptions } from "cronbake";
import { and, count, eq, gt, inArray, isNull, lt, notExists, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
  calendarAccountsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { account as authAccountTable } from "@keeper.sh/database/auth-schema";
import {
  calendarRowCarriesAProviderIdentity,
  calendarRowProviderIdentity,
  reconcileProviderAccountIdentity,
} from "@keeper.sh/database/provider-account-identity";
import {
  createCoordinatedRefresher,
  createGoogleTokenRefresher,
  createMicrosoftTokenRefresher,
  createTeardownResidueReaper,
  createTeardownResidueStore,
  ensureValidToken,
  fetchGoogleUserInfo,
  fetchMicrosoftUserInfo,
  resolveProviderAccountIdentity,
  resolvePushRegistrar,
  revokeGoogleGrant,
} from "@keeper.sh/calendar";
import type {
  GoogleRevocationFetch,
  ProviderUserInfo,
  RegistrarContext,
  SurvivingAccountLinkCensus,
  TeardownResidueRecord,
  TokenRefresher,
  TokenState,
  WebhookConfig,
} from "@keeper.sh/calendar";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";

const RESIDUE_STOP_TIMEOUT_MS = 5000;
const RESIDUE_REPAIR_DEADLINE_MS = 15_000;
const CENSUS_REPAIR_BUDGET_MS = 60_000;
const POLAR_RESOURCE_NOT_FOUND = "ResourceNotFound";
const NO_UNKNOWABLE_CREDENTIALS = 0;
const GOOGLE_INVALID_TOKEN_ERROR = "invalid_token";
const ORPHAN_CREDENTIAL_SWEEP_PROVIDERS = ["google", "outlook"];
const ORPHAN_CREDENTIAL_SAFETY_AGE_MS = 60 * 60 * 1000;
const CENSUS_REPAIR_FAILED_SLUG = "teardown-residue-census-repair-failed";
const NO_BLOCKING_CREDENTIALS = 0;
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const CENSUS_REPAIR_BATCH_LIMIT = 10;
const NO_REMAINING_BLOCKING_ROWS = 0;
const NO_BLOCKING_ROWS_AFTER_CURSOR = 0;
const NO_ORPHANED_CREDENTIALS = 0;

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

const parseRefusalBody = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

const grantIsAlreadyNotInForce = (body: string): boolean => {
  const parsed = parseRefusalBody(body);

  return isRecord(parsed) && parsed.error === GOOGLE_INVALID_TOKEN_ERROR;
};

const revokeOAuthGrant = async (
  record: TeardownResidueRecord,
  token: string,
  options?: { fetchImpl: GoogleRevocationFetch },
): Promise<void> => {
  if (record.provider !== "google") {
    throw new Error(
      `OAuth grant residue ${record.id} for user ${record.userId} names provider ${record.provider ?? "none"}, which has no revocation endpoint wired`,
    );
  }

  const outcome = await revokeGoogleGrant(token, {
    fetchImpl: options?.fetchImpl ?? globalThis.fetch,
  });

  if (outcome.revoked || grantIsAlreadyNotInForce(outcome.body)) {
    return;
  }

  throw new Error(
    `Google refused to revoke the grant behind residue ${record.id} `
      + `(${outcome.status}): ${outcome.body}`,
  );
};

const credentialHoldsTheAccount = (
  provider: string,
  accountEmail: string,
  providerAccountId: string | null,
): SQL => {
  if (providerAccountId === null) {
    return sql`lower(${oauthCredentialsTable.email}) = lower(${accountEmail})`;
  }

  return sql`lower(${oauthCredentialsTable.email}) = lower(${accountEmail}) or (${oauthCredentialsTable.email} is null and exists (select 1 from ${calendarAccountsTable} where ${calendarAccountsTable.oauthCredentialId} = ${oauthCredentialsTable.id} and ${calendarAccountsTable.provider} = ${provider} and ${calendarRowCarriesAProviderIdentity()} and ${calendarAccountsTable.accountId} = ${providerAccountId})) or exists (select 1 from ${calendarAccountsTable} where ${calendarAccountsTable.oauthCredentialId} = ${oauthCredentialsTable.id} and ${calendarAccountsTable.provider} = ${provider} and lower(${calendarAccountsTable.email}) = lower(${accountEmail}))`;
};

const calendarRowNamesADifferentAccount = (
  provider: string,
  accountEmail: string,
  providerAccountId: string,
): SQL =>
  sql`exists (select 1 from ${calendarAccountsTable} where ${calendarAccountsTable.oauthCredentialId} = ${oauthCredentialsTable.id} and ${calendarAccountsTable.provider} = ${provider} and ((${calendarRowCarriesAProviderIdentity()} and ${calendarAccountsTable.accountId} <> ${providerAccountId}) or (${calendarRowCarriesAProviderIdentity()} and ${calendarAccountsTable.email} is not null and lower(${calendarAccountsTable.email}) <> lower(${accountEmail}))))`;

const credentialHasACalendarRowForTheProvider = (provider: string): SQL =>
  sql`exists (select 1 from ${calendarAccountsTable} where ${calendarAccountsTable.oauthCredentialId} = ${oauthCredentialsTable.id} and ${calendarAccountsTable.provider} = ${provider})`;

const calendarRowsNameNoAccountAtAll = (
  provider: string,
  accountEmail: string,
  providerAccountId: string,
): SQL =>
  sql`${credentialHasACalendarRowForTheProvider(provider)} and not exists (select 1 from ${calendarAccountsTable} where ${calendarAccountsTable.oauthCredentialId} = ${oauthCredentialsTable.id} and ${calendarAccountsTable.provider} = ${provider} and ${calendarRowCarriesAProviderIdentity()}) and not ${calendarRowNamesADifferentAccount(provider, accountEmail, providerAccountId)}`;

const credentialIsLinkedToNoCalendarAccount = (provider: string): SQL =>
  sql`not ${credentialHasACalendarRowForTheProvider(provider)}`;

const credentialIdentityIsUnknowable = (
  provider: string,
  accountEmail: string,
  providerAccountId: string | null,
): SQL => {
  if (providerAccountId === null) {
    return sql`${oauthCredentialsTable.email} is null`;
  }

  return sql`(${credentialHoldsTheAccount(provider, accountEmail, providerAccountId)}) is not true and ((${calendarRowsNameNoAccountAtAll(provider, accountEmail, providerAccountId)}) or (${credentialIsLinkedToNoCalendarAccount(provider)}))`;
};

const censusSurvivingCredentialLinks = async (
  database: PgDatabase<PgQueryResultHKT>,
  record: TeardownResidueRecord,
  provider: string,
  accountEmail: string,
  providerAccountId: string | null,
): Promise<SurvivingAccountLinkCensus> => {
  const [row] = await database
    .select({
      surviving: sql<number>`count(*) filter (where ${credentialHoldsTheAccount(provider, accountEmail, providerAccountId)})`
        .mapWith(Number),
      unknowableIds: sql<
        string[]
      >`coalesce(array_agg(${oauthCredentialsTable.id}) filter (where ${credentialIdentityIsUnknowable(provider, accountEmail, providerAccountId)}), '{}')`,
    })
    .from(oauthCredentialsTable)
    .where(eq(oauthCredentialsTable.provider, provider));

  if (!row) {
    throw new Error(
      `Counting surviving credential links to ${provider} account behind residue ${record.id} returned no row`,
    );
  }

  return {
    blockingCredentialIds: row.unknowableIds,
    coHolders: row.surviving,
    identityResolved: row.unknowableIds.length === NO_UNKNOWABLE_CREDENTIALS,
  };
};

const countSurvivingSocialSignInLinks = async (
  database: PgDatabase<PgQueryResultHKT>,
  record: TeardownResidueRecord,
  provider: string,
  providerAccountId: string,
): Promise<number> => {
  const [row] = await database
    .select({ surviving: count() })
    .from(authAccountTable)
    .where(
      and(
        eq(authAccountTable.providerId, provider),
        eq(authAccountTable.accountId, providerAccountId),
      ),
    );

  if (!row) {
    throw new Error(
      `Counting surviving sign-in links to ${provider} account behind residue ${record.id} returned no row`,
    );
  }

  return row.surviving;
};

const countSurvivingCalendarAccountLinks = async (
  database: PgDatabase<PgQueryResultHKT>,
  record: TeardownResidueRecord,
  provider: string,
  providerAccountId: string,
): Promise<number> => {
  const [row] = await database
    .select({ surviving: count() })
    .from(calendarAccountsTable)
    .where(
      and(
        eq(calendarAccountsTable.provider, provider),
        eq(calendarAccountsTable.accountId, providerAccountId),
      ),
    );

  if (!row) {
    throw new Error(
      `Counting surviving calendar account links to ${provider} account behind residue ${record.id} returned no row`,
    );
  }

  return row.surviving;
};

const countSurvivingAccountLinks = async (
  database: PgDatabase<PgQueryResultHKT>,
  record: TeardownResidueRecord,
): Promise<SurvivingAccountLinkCensus> => {
  const { provider, accountEmail, providerAccountId } = record;

  if (!provider || !accountEmail) {
    throw new Error(
      `OAuth grant residue ${record.id} for user ${record.userId} names no provider account, so co-holders of the grant cannot be counted`,
    );
  }

  const credentialCensus = await censusSurvivingCredentialLinks(
    database,
    record,
    provider,
    accountEmail,
    providerAccountId ?? null,
  );

  if (!providerAccountId) {
    return credentialCensus;
  }

  const signInLinks = await countSurvivingSocialSignInLinks(
    database,
    record,
    provider,
    providerAccountId,
  );

  const calendarAccountLinks = await countSurvivingCalendarAccountLinks(
    database,
    record,
    provider,
    providerAccountId,
  );

  return {
    blockingCredentialIds: credentialCensus.blockingCredentialIds,
    coHolders: credentialCensus.coHolders + signInLinks + calendarAccountLinks,
    identityResolved: credentialCensus.identityResolved,
  };
};

const sweepOrphanedOAuthCredentials = async ({
  database,
  minimumAgeMs,
  now,
}: {
  database: PgDatabase<PgQueryResultHKT>;
  minimumAgeMs: number;
  now: () => Date;
}): Promise<number> => {
  const createdBefore = new Date(now().getTime() - minimumAgeMs);

  const hasNoCalendarAccount = (executor: PgDatabase<PgQueryResultHKT>) =>
    notExists(
      executor
        .select({ id: calendarAccountsTable.id })
        .from(calendarAccountsTable)
        .where(eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id)),
    );

  return await database.transaction(async (transaction) => {
    const claimed = await transaction
      .select({ id: oauthCredentialsTable.id })
      .from(oauthCredentialsTable)
      .where(
        and(
          inArray(oauthCredentialsTable.provider, ORPHAN_CREDENTIAL_SWEEP_PROVIDERS),
          lt(oauthCredentialsTable.createdAt, createdBefore),
          hasNoCalendarAccount(transaction),
        ),
      )
      .for("update");

    if (claimed.length === NO_ORPHANED_CREDENTIALS) {
      return NO_ORPHANED_CREDENTIALS;
    }

    const swept = await transaction
      .delete(oauthCredentialsTable)
      .where(
        and(
          inArray(
            oauthCredentialsTable.id,
            claimed.map((credential) => credential.id),
          ),
          hasNoCalendarAccount(transaction),
        ),
      )
      .returning({ id: oauthCredentialsTable.id });

    return swept.length;
  });
};

interface CensusBlockingCalendarRow {
  accessToken: string;
  accountRowId: string;
  credentialId: string;
  expiresAt: Date;
  provider: string;
  refreshToken: string;
}

interface CensusRepairCursor {
  read: () => string | null;
  write: (afterAccountRowId: string | null) => void;
}

interface CensusRepairBudget {
  budgetMs: number;
  cursor: CensusRepairCursor;
  now: () => Date;
}

interface CensusRepairTally {
  attempted: number;
  remaining: number;
  repaired: number;
}

const resolveUserInfoFetch = (
  provider: string,
): ((accessToken: string) => Promise<ProviderUserInfo>) | null => {
  if (provider === "google") {
    return fetchGoogleUserInfo;
  }

  if (provider === "outlook") {
    return fetchMicrosoftUserInfo;
  }

  return null;
};

const censusCursorFilters = (afterAccountRowId: string | null): SQL[] => {
  if (afterAccountRowId === null) {
    return [];
  }

  return [gt(calendarAccountsTable.id, afterAccountRowId)];
};

const censusBlockingRowsWhere = (
  credentialIds: string[],
  afterAccountRowId: string | null = null,
): SQL | undefined =>
  and(
    inArray(oauthCredentialsTable.id, credentialIds),
    isNull(calendarRowProviderIdentity()),
    ...censusCursorFilters(afterAccountRowId),
  );

const countCensusBlockingCalendarRows = async (
  database: PgDatabase<PgQueryResultHKT>,
  credentialIds: string[],
): Promise<number> => {
  const [row] = await database
    .select({ blocking: count() })
    .from(calendarAccountsTable)
    .innerJoin(
      oauthCredentialsTable,
      eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .where(censusBlockingRowsWhere(credentialIds));

  if (!row) {
    throw new Error(
      "Counting the calendar rows blocking the teardown residue census returned no row",
    );
  }

  return row.blocking;
};

const listCensusBlockingCalendarRows = (
  database: PgDatabase<PgQueryResultHKT>,
  credentialIds: string[],
  afterAccountRowId: string | null = null,
): Promise<CensusBlockingCalendarRow[]> =>
  database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      accountRowId: calendarAccountsTable.id,
      credentialId: oauthCredentialsTable.id,
      expiresAt: oauthCredentialsTable.expiresAt,
      provider: calendarAccountsTable.provider,
      refreshToken: oauthCredentialsTable.refreshToken,
    })
    .from(calendarAccountsTable)
    .innerJoin(
      oauthCredentialsTable,
      eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .where(censusBlockingRowsWhere(credentialIds, afterAccountRowId))
    .orderBy(calendarAccountsTable.id)
    .limit(CENSUS_REPAIR_BATCH_LIMIT);

const resolveBlockingRowAccessToken = async (
  database: PgDatabase<PgQueryResultHKT>,
  row: CensusBlockingCalendarRow,
): Promise<string> => {
  if (row.expiresAt.getTime() - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
    return row.accessToken;
  }

  const { default: environment } = await import("@/env");
  const refresher = resolveTokenRefresher(row.provider, {
    googleClientId: environment.GOOGLE_CLIENT_ID,
    googleClientSecret: environment.GOOGLE_CLIENT_SECRET,
    microsoftClientId: environment.MICROSOFT_CLIENT_ID,
    microsoftClientSecret: environment.MICROSOFT_CLIENT_SECRET,
  });

  if (!refresher) {
    throw new Error(
      `The access token behind calendar account ${row.accountRowId} has expired and no ${row.provider} refresher is configured, so its provider identity cannot be resolved`,
    );
  }

  const tokenState: TokenState = {
    accessToken: row.accessToken,
    accessTokenExpiresAt: row.expiresAt,
    refreshToken: row.refreshToken,
  };

  const { refreshLockStore } = await import("@/context");

  await ensureValidToken(
    tokenState,
    createCoordinatedRefresher({
      calendarAccountId: row.accountRowId,
      database,
      oauthCredentialId: row.credentialId,
      rawRefresh: refresher,
      refreshLockStore,
    }),
  );

  return tokenState.accessToken;
};

const repairCensusBlockingRow = async (
  database: PgDatabase<PgQueryResultHKT>,
  row: CensusBlockingCalendarRow,
): Promise<void> => {
  const fetchUserInfo = resolveUserInfoFetch(row.provider);

  if (!fetchUserInfo) {
    throw new Error(
      `Calendar account ${row.accountRowId} names provider ${row.provider}, which has no user info endpoint wired, so the stalled census cannot be repaired`,
    );
  }

  const providerAccountId = await resolveProviderAccountIdentity({
    fetchUserInfo,
    resolveAccessToken: () => resolveBlockingRowAccessToken(database, row),
    subject: `calendar account ${row.accountRowId}`,
  });

  await reconcileProviderAccountIdentity({
    accountRowId: row.accountRowId,
    adopt: (unclaimedIdentity) =>
      database.execute(
        sql`update ${calendarAccountsTable} set ${sql.identifier(calendarAccountsTable.accountId.name)} = ${providerAccountId} where ${unclaimedIdentity}`,
      ),
    database,
    providerAccountId,
  });
};

const createCensusRepairCursor = (): CensusRepairCursor => {
  let afterAccountRowId: string | null = null;

  return {
    read: () => afterAccountRowId,
    write: (next) => {
      afterAccountRowId = next;
    },
  };
};

const censusRepairCursor = createCensusRepairCursor();

const listCensusBlockingCalendarRowsFromCursor = async (
  database: PgDatabase<PgQueryResultHKT>,
  credentialIds: string[],
  cursor: CensusRepairCursor,
): Promise<CensusBlockingCalendarRow[]> => {
  const afterAccountRowId = cursor.read();
  const rows = await listCensusBlockingCalendarRows(
    database,
    credentialIds,
    afterAccountRowId,
  );

  if (rows.length > NO_BLOCKING_ROWS_AFTER_CURSOR || afterAccountRowId === null) {
    return rows;
  }

  cursor.write(null);

  return listCensusBlockingCalendarRows(database, credentialIds);
};

const advanceCensusRepairCursor = (
  cursor: CensusRepairCursor,
  rows: CensusBlockingCalendarRow[],
  attempted: number,
): void => {
  const lastAttempted = rows[attempted - 1];

  if (!lastAttempted) {
    return;
  }

  if (attempted === rows.length && rows.length < CENSUS_REPAIR_BATCH_LIMIT) {
    cursor.write(null);

    return;
  }

  cursor.write(lastAttempted.accountRowId);
};

const repairCensusBlockingCredentials = async (
  database: PgDatabase<PgQueryResultHKT>,
  credentialIds: string[],
  {
    budgetMs = CENSUS_REPAIR_BUDGET_MS,
    cursor = censusRepairCursor,
    now = () => new Date(),
  }: Partial<CensusRepairBudget> = {},
): Promise<CensusRepairTally> => {
  if (credentialIds.length === NO_BLOCKING_CREDENTIALS) {
    return { attempted: 0, remaining: NO_REMAINING_BLOCKING_ROWS, repaired: 0 };
  }

  const blocking = await countCensusBlockingCalendarRows(database, credentialIds);
  const rows = await listCensusBlockingCalendarRowsFromCursor(
    database,
    credentialIds,
    cursor,
  );
  const startedAt = now().getTime();
  const results: boolean[] = [];

  for (const row of rows) {
    if (now().getTime() - startedAt >= budgetMs) {
      break;
    }

    try {
      await repairCensusBlockingRow(database, row);
      results.push(true);
    } catch (error) {
      widelog.errorFields(error, {
        retriable: true,
        slug: CENSUS_REPAIR_FAILED_SLUG,
      });
      results.push(false);
    }
  }

  advanceCensusRepairCursor(cursor, rows, results.length);

  return {
    attempted: results.length,
    remaining: Math.max(blocking - results.length, NO_REMAINING_BLOCKING_ROWS),
    repaired: results.filter(Boolean).length,
  };
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
    countSurvivingAccountLinks: (record) => countSurvivingAccountLinks(database, record),
    createRegistrarContext: createResidueRegistrarContext,
    deletePolarCustomer,
    now: () => new Date(),
    observe: (fields) => {
      widelog.setFields(fields);
    },
    recordError: (error, slug) => {
      widelog.errorFields(error, { retriable: true, slug });
    },
    repairDeadlineMs: RESIDUE_REPAIR_DEADLINE_MS,
    residue: createTeardownResidueStore({
      database,
      encryptionKey: environment.ENCRYPTION_KEY,
      now: () => new Date(),
    }),
    resolveRegistrar: resolvePushRegistrar,
    resolveResidueProviderAccountId: (record) => {
      const { provider } = record;

      if (!provider) {
        return Promise.resolve(null);
      }

      const fetchUserInfo = resolveUserInfoFetch(provider);

      if (!fetchUserInfo) {
        return Promise.resolve(null);
      }

      return resolveProviderAccountIdentity({
        fetchUserInfo,
        resolveAccessToken: () => resolveResidueAccessToken(record, provider),
        subject: `teardown residue ${record.id}`,
      });
    },
    revokeOAuthGrant,
    waitForRepairDeadline: (deadlineMs) =>
      new Promise((resolve) => {
        setTimeout(resolve, deadlineMs);
      }),
  });
};

export default withCronWideEvent({
  async callback() {
    const { database } = await import("@/context");
    const sweptOrphanedCredentials = await sweepOrphanedOAuthCredentials({
      database,
      minimumAgeMs: ORPHAN_CREDENTIAL_SAFETY_AGE_MS,
      now: () => new Date(),
    });
    widelog.setFields({ sweptOrphanedCredentials });
    const reap = await createDefaultReaper();
    const outcome = await reap();
    const censusRepair = await repairCensusBlockingCredentials(
      database,
      outcome.blockingCredentialIds,
    );
    widelog.setFields({
      "teardown_residue.census_repair_attempted_count": censusRepair.attempted,
      "teardown_residue.census_repair_remaining_count": censusRepair.remaining,
      "teardown_residue.census_repair_repaired_count": censusRepair.repaired,
    });
  },
  cron: "@every_5_minutes",
  name: import.meta.file,
  overrunProtection: true,
}) satisfies CronOptions;

export {
  CENSUS_REPAIR_BATCH_LIMIT,
  countSurvivingAccountLinks,
  repairCensusBlockingCredentials,
  revokeOAuthGrant,
  sweepOrphanedOAuthCredentials,
};
