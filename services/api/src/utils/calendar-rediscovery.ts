import {
  applyCalendarRediscoveryPlan,
  isCalendarListFailure,
  isProviderAuthFailure,
  isProviderTokenRefreshFailure,
  markCalendarRediscoveryAttempt,
} from "@keeper.sh/calendar";
import type {
  CalendarRediscoveryApplyInput,
  CalendarRediscoveryApplyResult,
  DiscoveredCalendar,
  InsertedCalendar,
} from "@keeper.sh/calendar";
import type { RefreshableAccount } from "./account-calendar-discovery";

class CalendarRefreshUnsupportedError extends Error {}
class CalendarRefreshUnconfiguredError extends Error {}

interface AccountCalendarRefreshDependencies {
  loadAccount: (accountId: string, userId: string) => Promise<RefreshableAccount | null>;
  markAttempt: (accountId: string, now: Date) => Promise<void>;
  discoverCalendars: (account: RefreshableAccount) => Promise<DiscoveredCalendar[]>;
  applyPlan: (input: CalendarRediscoveryApplyInput) => Promise<CalendarRediscoveryApplyResult>;
  markNeedsReauthentication: (accountId: string) => Promise<void>;
  enqueuePush: (userId: string) => void;
  encryptionKey: string | null;
  now: () => Date;
}

interface AccountCalendarRefreshSummary {
  added: InsertedCalendar[];
  revived: number;
  unavailable: number;
  unchanged: number;
  duplicates: number;
  crossAccountSkipped: number;
  discovered: number;
  suppressed: boolean;
  checkedAt: Date;
}

const assertRefreshable = (
  account: RefreshableAccount,
  encryptionKey: string | null,
): void => {
  if (account.authType !== "caldav" && account.authType !== "oauth") {
    throw new CalendarRefreshUnsupportedError(
      "This account does not support calendar discovery.",
    );
  }

  if (account.authType === "caldav" && !encryptionKey) {
    throw new CalendarRefreshUnconfiguredError("Encryption key not configured");
  }
};

const discoverWithClassification = async (
  account: RefreshableAccount,
  dependencies: AccountCalendarRefreshDependencies,
): Promise<DiscoveredCalendar[]> => {
  try {
    return await dependencies.discoverCalendars(account);
  } catch (error) {
    if (isProviderAuthFailure(error) || isProviderTokenRefreshFailure(error)) {
      await dependencies.markNeedsReauthentication(account.id);
    }
    throw error;
  }
};

const runAccountCalendarRefresh = async (
  options: { accountId: string; userId: string },
  dependencies: AccountCalendarRefreshDependencies,
): Promise<AccountCalendarRefreshSummary> => {
  const account = await dependencies.loadAccount(options.accountId, options.userId);
  if (!account) {
    throw new Error(`Calendar account ${options.accountId} is not available to refresh`);
  }

  assertRefreshable(account, dependencies.encryptionKey);

  const now = dependencies.now();
  await dependencies.markAttempt(account.id, now);

  const discovered = await discoverWithClassification(account, dependencies);

  const result = await dependencies.applyPlan({
    accountId: account.id,
    caldavServerHost: account.caldavServerHost ?? null,
    calendarType: account.calendarType,
    discovered,
    now,
    userId: account.userId,
  });

  if (result.inserted.length > 0 || result.toRevive.length > 0) {
    dependencies.enqueuePush(account.userId);
  }

  return {
    added: result.inserted,
    checkedAt: now,
    crossAccountSkipped: result.crossAccountSkippedCount,
    discovered: discovered.length,
    duplicates: result.duplicateCount,
    revived: result.toRevive.length,
    suppressed: result.suppressed,
    unavailable: result.toMarkUnavailable.length,
    unchanged: result.unchangedCount,
  };
};

const createDefaultAccountCalendarRefreshDependencies = async (
): Promise<AccountCalendarRefreshDependencies> => {
  const { database, encryptionKey, premiumService } = await import("@/context");
  const { spawnBackgroundJob } = await import("./background-task");
  const { enqueuePushSync } = await import("./enqueue-push-sync");
  const {
    discoverCalDAVAccountCalendars,
    discoverOAuthAccountCalendars,
    loadRefreshableAccount,
    markAccountNeedsReauthentication,
  } = await import("./account-calendar-discovery");

  return {
    applyPlan: (input) => applyCalendarRediscoveryPlan(database, input),
    discoverCalendars: (account) => {
      if (account.authType !== "caldav") {
        return discoverOAuthAccountCalendars(account.id, account.provider);
      }
      if (!encryptionKey) {
        throw new CalendarRefreshUnconfiguredError("Encryption key not configured");
      }
      return discoverCalDAVAccountCalendars(account.id, encryptionKey);
    },
    encryptionKey: encryptionKey ?? null,
    enqueuePush: (userId) => {
      spawnBackgroundJob("calendar-refresh-push", { "user.id": userId }, async () => {
        const plan = await premiumService.getUserPlan(userId);
        if (!plan) {
          throw new Error("Unable to resolve user plan for calendar refresh push");
        }
        await enqueuePushSync(userId, plan);
      });
    },
    loadAccount: loadRefreshableAccount,
    markAttempt: (accountId, now) =>
      markCalendarRediscoveryAttempt(database, accountId, now),
    markNeedsReauthentication: markAccountNeedsReauthentication,
    now: () => new Date(),
  };
};

export {
  CalendarRefreshUnconfiguredError,
  CalendarRefreshUnsupportedError,
  createDefaultAccountCalendarRefreshDependencies,
  isCalendarListFailure,
  isProviderAuthFailure,
  isProviderTokenRefreshFailure,
  runAccountCalendarRefresh,
};
export type {
  AccountCalendarRefreshDependencies,
  AccountCalendarRefreshSummary,
  RefreshableAccount,
};
