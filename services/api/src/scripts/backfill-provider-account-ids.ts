import { calendarAccountsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { database, oauthProviders } from "@/context";
import { context, destroy, widelog } from "@/utils/logging";

const PUSH_PROVIDERS = ["google", "outlook"];
const EXPIRY_SKEW_MS = 60_000;

interface BackfillRow {
  accountRowId: string;
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
      ),
    ));

const resolveAccessToken = async (row: BackfillRow): Promise<string> => {
  if (row.expiresAt.getTime() - EXPIRY_SKEW_MS > Date.now()) {
    return row.accessToken;
  }

  const provider = oauthProviders.getProvider(row.provider);
  if (!provider) {
    throw new Error(`No OAuth provider registered for ${row.provider}`);
  }

  const refreshed = await provider.refreshAccessToken(row.refreshToken);
  return refreshed.access_token;
};

const resolveProviderAccountId = async (row: BackfillRow): Promise<string> => {
  const provider = oauthProviders.getProvider(row.provider);
  if (!provider) {
    throw new Error(`No OAuth provider registered for ${row.provider}`);
  }

  const accessToken = await resolveAccessToken(row);
  const userInfo = await provider.fetchUserInfo(accessToken);

  if (!userInfo.id) {
    throw new Error(`${row.provider} returned no account id for account ${row.accountRowId}`);
  }

  return userInfo.id;
};

const backfillRow = (row: BackfillRow, tally: BackfillTally): Promise<void> =>
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
      const providerAccountId = await resolveProviderAccountId(row);

      await database
        .update(calendarAccountsTable)
        .set({ accountId: providerAccountId })
        .where(eq(calendarAccountsTable.id, row.accountRowId));

      tally.updated += 1;
      widelog.set("provider.account_id", providerAccountId);
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
