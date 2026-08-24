import type { CronOptions } from "cronbake";
import type { Plan } from "@keeper.sh/data-schemas";
import {
  allSettledWithConcurrency,
  applyCalendarRediscoveryPlan,
  createCoordinatedRefresher,
  createGoogleTokenRefresher,
  createMicrosoftTokenRefresher,
  createRedisRateLimiter,
  ensureValidToken,
  isProviderAuthFailure,
  isProviderTokenRefreshFailure,
  isTimeoutError,
  markCalendarRediscoveryAttempt,
  resolveRediscoveryCalendarType,
  toDiscoveredCalDAVCalendars,
  toDiscoveredGoogleCalendars,
  toDiscoveredOutlookCalendars,
} from "@keeper.sh/calendar";
import type { DiscoveredCalendar, TokenState } from "@keeper.sh/calendar";
import {
  createCalDAVClient,
  resolveCalDAVServerHost,
} from "@keeper.sh/calendar/caldav";
import type { CalDAVAuthMethod } from "@keeper.sh/calendar/digest-fetch";
import { listUserCalendars as listGoogleCalendars } from "@keeper.sh/calendar/google";
import { listUserCalendars as listOutlookCalendars } from "@keeper.sh/calendar/outlook";
import { buildImportedCalendarExists, decryptPassword } from "@keeper.sh/database";
import {
  caldavCredentialsTable,
  calendarAccountsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { context, widelog } from "@/utils/logging";
import { database, premiumService, refreshLockRedis, refreshLockStore } from "@/context";
import env from "@/env";
import { safeFetchOptions } from "@/utils/safe-fetch-options";
import { releaseRefreshLock } from "@/utils/refresh-lock-release";
import { raceAbortSignal, withAbortTimeout } from "@/utils/with-abort-timeout";
import { filterSourcesByPlan } from "@/utils/source-plan-selection";
import {
  excludeAccountsWithoutImportedCalendars,
  excludeUnconfiguredCalDAVAccounts,
  selectAccountsDueForRediscovery,
} from "@/utils/rediscovery-selection";
import type { RediscoveryCandidate } from "@/utils/rediscovery-selection";

const REDISCOVER_ACCOUNT_TIMEOUT_MS = 60_000;
const REDISCOVER_CONCURRENCY = 5;
const REDISCOVER_BATCH_LIMIT = 200;
const REDISCOVER_LOCK_TTL_SECONDS = 120;
const REDISCOVER_LOCK_KEY_PREFIX = "calendar-rediscover:";
const GOOGLE_REQUESTS_PER_MINUTE = 500;
const GOOGLE_CALENDAR_LIST_REQUEST_SLOTS = 1;
const HOUR_MS = 60 * 60 * 1000;
const PRO_STALENESS_MS = 6 * HOUR_MS;
const FREE_STALENESS_MS = 24 * HOUR_MS;

interface RediscoveryAccount extends RediscoveryCandidate {
  hasImportedCalendar: boolean;
  accessToken: string | null;
  authMethod: string | null;
  encryptedPassword: string | null;
  expiresAt: Date | null;
  oauthCredentialId: string | null;
  refreshToken: string | null;
  serverUrl: string | null;
  username: string | null;
}

interface RediscoveryBatchOutcome {
  added: number;
  errors: number;
  skipped: number;
  unavailable: number;
}

const EMPTY_OUTCOME: RediscoveryBatchOutcome = {
  added: 0,
  errors: 0,
  skipped: 0,
  unavailable: 0,
};

const loadRediscoveryCandidates = (): Promise<RediscoveryAccount[]> =>
  database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      accountId: calendarAccountsTable.id,
      authMethod: caldavCredentialsTable.authMethod,
      authType: calendarAccountsTable.authType,
      calendarsRefreshAttemptedAt: calendarAccountsTable.calendarsRefreshAttemptedAt,
      calendarsRefreshedAt: calendarAccountsTable.calendarsRefreshedAt,
      encryptedPassword: caldavCredentialsTable.encryptedPassword,
      expiresAt: oauthCredentialsTable.expiresAt,
      hasImportedCalendar: buildImportedCalendarExists(),
      oauthCredentialId: oauthCredentialsTable.id,
      provider: calendarAccountsTable.provider,
      refreshToken: oauthCredentialsTable.refreshToken,
      serverUrl: caldavCredentialsTable.serverUrl,
      userId: calendarAccountsTable.userId,
      username: caldavCredentialsTable.username,
    })
    .from(calendarAccountsTable)
    .leftJoin(
      oauthCredentialsTable,
      eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .leftJoin(
      caldavCredentialsTable,
      eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
    )
    .where(and(
      eq(calendarAccountsTable.needsReauthentication, false),
      inArray(calendarAccountsTable.authType, ["oauth", "caldav"]),
    ));

const resolveTokenRefresher = (provider: string) => {
  if (provider === "google" && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return createGoogleTokenRefresher({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    });
  }

  if (provider === "outlook" && env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    return createMicrosoftTokenRefresher({
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
    });
  }

  return null;
};

const discoverOAuthCalendars = async (
  account: RediscoveryAccount,
  signal: AbortSignal,
): Promise<DiscoveredCalendar[]> => {
  if (!account.oauthCredentialId || !account.accessToken
    || !account.refreshToken || !account.expiresAt) {
    throw new Error(`Calendar account ${account.accountId} has no OAuth credential`);
  }

  const tokenState: TokenState = {
    accessToken: account.accessToken,
    accessTokenExpiresAt: account.expiresAt,
    refreshToken: account.refreshToken,
  };

  signal.throwIfAborted();

  const rawRefresher = resolveTokenRefresher(account.provider);
  if (rawRefresher) {
    await ensureValidToken(tokenState, createCoordinatedRefresher({
      calendarAccountId: account.accountId,
      database,
      oauthCredentialId: account.oauthCredentialId,
      rawRefresh: rawRefresher,
      refreshLockStore,
    }));
  }

  signal.throwIfAborted();

  if (account.provider === "google") {
    const rateLimiter = createRedisRateLimiter(
      refreshLockRedis,
      `ratelimit:${account.userId}:google`,
      { requestsPerMinute: GOOGLE_REQUESTS_PER_MINUTE },
    );
    await rateLimiter.acquire(GOOGLE_CALENDAR_LIST_REQUEST_SLOTS, signal);
    return toDiscoveredGoogleCalendars(
      await listGoogleCalendars(tokenState.accessToken, { signal }),
    );
  }

  return toDiscoveredOutlookCalendars(
    await listOutlookCalendars(tokenState.accessToken, { signal }),
  );
};

const discoverCalDAVCalendars = async (
  account: RediscoveryAccount,
  encryptionKey: string,
  signal: AbortSignal,
): Promise<DiscoveredCalendar[]> => {
  if (!account.serverUrl || !account.username || !account.encryptedPassword) {
    throw new Error(`Calendar account ${account.accountId} has no CalDAV credential`);
  }

  const client = createCalDAVClient({
    authMethod: (account.authMethod ?? "basic") as CalDAVAuthMethod,
    credentials: {
      password: decryptPassword(account.encryptedPassword, encryptionKey),
      username: account.username,
    },
    serverUrl: account.serverUrl,
  }, { ...safeFetchOptions, signal });

  return toDiscoveredCalDAVCalendars(await client.discoverCalendars());
};

const discoverAccountCalendars = (
  account: RediscoveryAccount,
  signal: AbortSignal,
): Promise<DiscoveredCalendar[]> => {
  if (account.authType === "caldav") {
    if (!env.ENCRYPTION_KEY) {
      throw new Error(
        `Calendar account ${account.accountId} needs ENCRYPTION_KEY to rediscover CalDAV calendars`,
      );
    }
    return discoverCalDAVCalendars(account, env.ENCRYPTION_KEY, signal);
  }
  return discoverOAuthCalendars(account, signal);
};

const rediscoverAccount = async (
  account: RediscoveryAccount,
  signal: AbortSignal,
): Promise<RediscoveryBatchOutcome> => {
  const now = new Date();
  await markCalendarRediscoveryAttempt(database, account.accountId, now);

  const discovered = await discoverAccountCalendars(account, signal);

  const result = await applyCalendarRediscoveryPlan(database, {
    accountId: account.accountId,
    caldavServerHost: resolveCalDAVServerHost(account.serverUrl),
    calendarType: resolveRediscoveryCalendarType(account.authType),
    discovered,
    now,
    userId: account.userId,
  });

  widelog.set("calendar_refresh.discovered", discovered.length);
  widelog.set("calendar_refresh.added", result.inserted.length);
  widelog.set("calendar_refresh.revived", result.toRevive.length);
  widelog.set("calendar_refresh.unavailable", result.toMarkUnavailable.length);
  widelog.set("calendar_refresh.unchanged", result.unchangedCount);
  widelog.set("calendar_refresh.duplicates", result.duplicateCount);
  widelog.set("calendar_refresh.cross_account_skipped", result.crossAccountSkippedCount);
  widelog.set("calendar_refresh.suppressed", result.suppressed);
  widelog.set("outcome", "success");

  return {
    added: result.inserted.length,
    errors: 0,
    skipped: 0,
    unavailable: result.toMarkUnavailable.length,
  };
};

const runAccountWithLock = async (
  account: RediscoveryAccount,
  signal: AbortSignal,
): Promise<RediscoveryBatchOutcome> => {
  const lockKey = `${REDISCOVER_LOCK_KEY_PREFIX}${account.accountId}`;
  const acquired = await refreshLockStore.tryAcquire(lockKey, REDISCOVER_LOCK_TTL_SECONDS);

  if (!acquired) {
    widelog.set("calendar_refresh.lock_contended", true);
    widelog.set("outcome", "skipped");
    return { ...EMPTY_OUTCOME, skipped: 1 };
  }

  try {
    return await rediscoverAccount(account, signal);
  } finally {
    await releaseRefreshLock(refreshLockStore, lockKey);
  }
};

const resolveTerminalAuthSlug = (error: unknown): string => {
  if (isProviderTokenRefreshFailure(error)) {
    return "provider-token-refresh-failed";
  }
  return "provider-auth-failed";
};

const resolveRediscoveryErrorSlug = (error: unknown): string => {
  if (!isTimeoutError(error)) {
    return "provider-api-error";
  }
  widelog.set("timeout.fired", true);
  widelog.set("timeout.kind", "account");
  widelog.set("timeout.limit_ms", REDISCOVER_ACCOUNT_TIMEOUT_MS);
  return "provider-request-timeout";
};

const rediscoverAccountWithReporting = (
  account: RediscoveryAccount,
): Promise<RediscoveryBatchOutcome> =>
  withAbortTimeout((signal) =>
    context(async () => {
      widelog.set("operation.name", "rediscover-account");
      widelog.set("operation.type", "job");
      widelog.set("user.id", account.userId);
      widelog.set("provider.name", account.provider);
      widelog.set("provider.account_id", account.accountId);

      try {
        return await widelog.time.measure(
          "duration_ms",
          () => raceAbortSignal(signal, runAccountWithLock(account, signal)),
        );
      } catch (error) {
        widelog.set("outcome", "error");

        if (isProviderAuthFailure(error) || isProviderTokenRefreshFailure(error)) {
          widelog.errorFields(error, {
            slug: resolveTerminalAuthSlug(error),
            retriable: false,
            requiresReauth: true,
          });

          await database
            .update(calendarAccountsTable)
            .set({ needsReauthentication: true })
            .where(eq(calendarAccountsTable.id, account.accountId));

          return { ...EMPTY_OUTCOME, errors: 1 };
        }

        widelog.errorFields(error, {
          slug: resolveRediscoveryErrorSlug(error),
          retriable: true,
        });
        throw error;
      } finally {
        widelog.flush();
      }
    }),
  REDISCOVER_ACCOUNT_TIMEOUT_MS);

const selectDueAccountsForPlan = async (
  candidates: RediscoveryAccount[],
  plan: Plan,
  stalenessMs: number,
  now: Date,
): Promise<RediscoveryAccount[]> => {
  const planAccounts = await filterSourcesByPlan(
    candidates,
    plan,
    (userId) => premiumService.getUserPlan(userId),
  );

  const { due, truncated } = selectAccountsDueForRediscovery(planAccounts, {
    batchLimit: REDISCOVER_BATCH_LIMIT,
    now,
    stalenessMs,
  });

  if (truncated) {
    widelog.set(`calendar_refresh.${plan}_truncated`, true);
  }

  return due;
};

const runRediscoveryBatch = async (): Promise<void> => {
  if (env.CALENDAR_REDISCOVERY_ENABLED === false) {
    widelog.set("calendar_refresh.disabled", true);
    return;
  }

  const now = new Date();
  const candidates = await loadRediscoveryCandidates();
  const { selectable: configured, excluded } = excludeUnconfiguredCalDAVAccounts(
    candidates,
    Boolean(env.ENCRYPTION_KEY),
  );

  if (excluded > 0) {
    widelog.set("calendar_refresh.skipped_reason", "encryption-key-missing");
    widelog.set("batch.accounts_unconfigured", excluded);
  }

  const { selectable, excluded: unimported } =
    excludeAccountsWithoutImportedCalendars(configured);

  widelog.set("batch.accounts_never_enumerated", unimported);

  const due = [
    ...await selectDueAccountsForPlan(selectable, "pro", PRO_STALENESS_MS, now),
    ...await selectDueAccountsForPlan(selectable, "free", FREE_STALENESS_MS, now),
  ];

  widelog.set("batch.candidate_count", candidates.length);
  widelog.set("batch.account_count", due.length);

  if (due.length === 0) {
    return;
  }

  const settlements = await allSettledWithConcurrency(
    due.map((account) => () => rediscoverAccountWithReporting(account)),
    { concurrency: REDISCOVER_CONCURRENCY },
  );

  const failures: unknown[] = [];
  let totals = EMPTY_OUTCOME;

  for (const settlement of settlements) {
    if (settlement.status === "rejected") {
      failures.push(settlement.reason);
      totals = { ...totals, errors: totals.errors + 1 };
      continue;
    }
    totals = {
      added: totals.added + settlement.value.added,
      errors: totals.errors + settlement.value.errors,
      skipped: totals.skipped + settlement.value.skipped,
      unavailable: totals.unavailable + settlement.value.unavailable,
    };
  }

  widelog.set("batch.calendars_added", totals.added);
  widelog.set("batch.calendars_unavailable", totals.unavailable);
  widelog.set("batch.accounts_skipped", totals.skipped);
  widelog.set("batch.accounts_failed", totals.errors);

  if (failures.length > 0) {
    throw new AggregateError(failures, "Calendar rediscovery completed with failures");
  }
};

export default withCronWideEvent({
  async callback() {
    await runRediscoveryBatch();
  },
  cron: "@every_15_minutes",
  immediate: false,
  name: "rediscover-calendars",
  overrunProtection: true,
}) satisfies CronOptions;
