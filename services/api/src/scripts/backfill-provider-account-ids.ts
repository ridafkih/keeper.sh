import type { RefreshLockStore } from "@keeper.sh/calendar";
import {
  resolveProviderAccountIdentity,
  runWithCredentialRefreshLock,
} from "@keeper.sh/calendar";
import { persistRotatedCredential } from "@keeper.sh/calendar/oauth-persistence";
import { withReauthenticationDemand } from "@keeper.sh/calendar/reauthentication";
import { TOKEN_REFRESH_BUFFER_MS } from "@keeper.sh/constants";
import { calendarAccountsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { reconcileProviderAccountIdentity } from "@keeper.sh/database/provider-account-identity";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { database, oauthProviders } from "@/context";
import {
  CONNECT_REFRESH_ACQUIRE_BUDGET_MS,
  CONNECT_WALL_TIME_CEILING_MS,
} from "@/utils/oauth-sources";
import { context, destroy, widelog } from "@/utils/logging";

const PUSH_PROVIDERS = ["google", "outlook"];
const EXPIRY_SKEW_MS = 60_000;
const MS_PER_SECOND = 1000;
const FIRST_RESULT_LIMIT = 1;

interface BackfillRow {
  accountRowId: string;
  oauthCredentialId: string;
  provider: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  credentialNeedsReauthentication: boolean;
  accountNeedsReauthentication: boolean;
}

interface BackfillTally {
  updated: number;
  skippedReauth: number;
  failed: number;
}

const selectCandidates = (): Promise<BackfillRow[]> =>
  database
    .select({
      accountRowId: calendarAccountsTable.id,
      oauthCredentialId: oauthCredentialsTable.id,
      provider: calendarAccountsTable.provider,
      email: calendarAccountsTable.email,
      accessToken: oauthCredentialsTable.accessToken,
      refreshToken: oauthCredentialsTable.refreshToken,
      expiresAt: oauthCredentialsTable.expiresAt,
      credentialNeedsReauthentication: oauthCredentialsTable.needsReauthentication,
      accountNeedsReauthentication: calendarAccountsTable.needsReauthentication,
    })
    .from(calendarAccountsTable)
    .innerJoin(
      oauthCredentialsTable,
      eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .where(and(
      inArray(calendarAccountsTable.provider, PUSH_PROVIDERS),
      or(
        isNull(calendarAccountsTable.accountId),
        eq(calendarAccountsTable.accountId, ""),
        sql`${calendarAccountsTable.accountId} = ${calendarAccountsTable.id}::text`,
      ),
    ));

const readStoredRefreshToken = async (oauthCredentialId: string): Promise<string | null> => {
  const [stored] = await database
    .select({ refreshToken: oauthCredentialsTable.refreshToken })
    .from(oauthCredentialsTable)
    .where(eq(oauthCredentialsTable.id, oauthCredentialId))
    .limit(FIRST_RESULT_LIMIT);

  return stored?.refreshToken ?? null;
};

const readFreshCredential = async (oauthCredentialId: string) => {
  const [stored] = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      expiresAt: oauthCredentialsTable.expiresAt,
    })
    .from(oauthCredentialsTable)
    .where(eq(oauthCredentialsTable.id, oauthCredentialId))
    .limit(FIRST_RESULT_LIMIT);

  if (!stored?.accessToken || !stored.expiresAt) {
    return null;
  }

  const remainingMs = stored.expiresAt.getTime() - Date.now();

  if (remainingMs <= TOKEN_REFRESH_BUFFER_MS) {
    return null;
  }

  return {
    access_token: stored.accessToken,
    expires_in: Math.floor(remainingMs / MS_PER_SECOND),
  };
};

interface BackfillDeadline {
  remainingMs: () => number;
  signal: AbortSignal;
}

const openBackfillDeadline = (): BackfillDeadline => {
  const expiresAt = Date.now() + CONNECT_WALL_TIME_CEILING_MS;

  return {
    remainingMs: () => Math.max(0, expiresAt - Date.now()),
    signal: AbortSignal.timeout(CONNECT_WALL_TIME_CEILING_MS),
  };
};

const resolveAccessToken = async (
  row: BackfillRow,
  deadline: BackfillDeadline = openBackfillDeadline(),
): Promise<string> => {
  if (row.expiresAt.getTime() - EXPIRY_SKEW_MS > Date.now()) {
    return row.accessToken;
  }

  const provider = oauthProviders.getProvider(row.provider);
  if (!provider) {
    throw new Error(`No OAuth provider registered for ${row.provider}`);
  }

  const lockStore: RefreshLockStore = {
    release: async (key) => {
      const { refreshLockStore } = await import("@/context");
      await refreshLockStore.release(key);
    },
    tryAcquire: async (key, ttlSeconds) => {
      const { refreshLockStore } = await import("@/context");
      return refreshLockStore.tryAcquire(key, ttlSeconds);
    },
  };

  const refreshed = await runWithCredentialRefreshLock(
    row.oauthCredentialId,
    () =>
      withReauthenticationDemand(database, { calendarAccountId: row.accountRowId }, async () => {
        const presentedRefreshToken = await readStoredRefreshToken(row.oauthCredentialId)
          ?? row.refreshToken;

        const result = await provider.refreshAccessToken(presentedRefreshToken, {
          signal: deadline.signal,
        });

        await persistRotatedCredential(
          database,
          row.oauthCredentialId,
          presentedRefreshToken,
          result,
        );

        return result;
      }),
    lockStore,
    () => readFreshCredential(row.oauthCredentialId),
    Math.min(CONNECT_REFRESH_ACQUIRE_BUDGET_MS, deadline.remainingMs()),
  );

  return refreshed.access_token;
};

const resolveProviderAccountId = (
  row: BackfillRow,
  deadline: BackfillDeadline,
): Promise<string> => {
  const provider = oauthProviders.getProvider(row.provider);
  if (!provider) {
    throw new Error(`No OAuth provider registered for ${row.provider}`);
  }

  return resolveProviderAccountIdentity({
    fetchUserInfo: (accessToken) => provider.fetchUserInfo(accessToken, { signal: deadline.signal }),
    resolveAccessToken: () => resolveAccessToken(row, deadline),
    subject: `calendar account ${row.accountRowId}`,
  });
};

const backfillRow = (
  row: BackfillRow,
  tally: BackfillTally,
  deadline: BackfillDeadline = openBackfillDeadline(),
): Promise<void> =>
  context(async () => {
    widelog.set("operation.name", "backfill-provider-account-id");
    widelog.set("operation.type", "script");
    widelog.set("provider.name", row.provider);
    widelog.set("account.id", row.accountRowId);

    if (row.accountNeedsReauthentication || row.credentialNeedsReauthentication) {
      tally.skippedReauth += 1;
      widelog.set("outcome", "skipped");
      widelog.set("skip.reason", "needs-reauthentication");
      widelog.flush();
      return;
    }

    try {
      const providerAccountId = await resolveProviderAccountId(row, deadline);

      const reconciliation = await reconcileProviderAccountIdentity({
        accountRowId: row.accountRowId,
        adopt: (unclaimedIdentity) =>
          database
            .update(calendarAccountsTable)
            .set({ accountId: providerAccountId })
            .where(unclaimedIdentity),
        database,
        providerAccountId,
      });

      tally.updated += 1;
      widelog.set("provider.account_id", providerAccountId);
      widelog.set("provider.identity_reconciliation", reconciliation);
      widelog.set("outcome", "success");
    } catch (error) {
      tally.failed += 1;
      widelog.set("outcome", "error");
      widelog.errorFields(error, { slug: "backfill-provider-account-id-failed" });
    } finally {
      widelog.flush();
    }
  });

const resolveOutcome = (failed: number): "partial" | "success" => {
  if (failed > 0) {
    return "partial";
  }
  return "success";
};

const run = (): Promise<void> =>
  context(async () => {
    const rows = await selectCandidates();
    const tally: BackfillTally = { updated: 0, skippedReauth: 0, failed: 0 };

    for (const row of rows) {
      await backfillRow(row, tally);
    }

    widelog.set("operation.name", "backfill-provider-account-ids");
    widelog.set("operation.type", "script");
    widelog.set("backfill.candidate_count", rows.length);
    widelog.set("backfill.updated_count", tally.updated);
    widelog.set("backfill.skipped_reauth_count", tally.skippedReauth);
    widelog.set("backfill.failed_count", tally.failed);
    widelog.set("outcome", resolveOutcome(tally.failed));
    widelog.flush();

    if (tally.failed > 0) {
      process.exitCode = 1;
    }
  });

await run();
await destroy();

export { backfillRow, resolveAccessToken, selectCandidates };
