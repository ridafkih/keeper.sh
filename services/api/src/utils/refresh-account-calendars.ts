import {
  calendarAccountsTable,
  calendarRemovalsTable,
  calendarsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { listUserCalendars as listOutlookCalendars } from "@keeper.sh/calendar/outlook";
import { listUserCalendars as listGoogleCalendars } from "@keeper.sh/calendar/google";
import {
  createSourceCalendarInsertDependencies,
  insertSourceCalendars,
} from "./source-calendar-insert";

const OAUTH_CALENDAR_TYPE = "oauth";
const FIRST_RESULT_LIMIT = 1;

class AccountNotFoundError extends Error {
  constructor() {
    super("Account not found");
  }
}

interface ExternalCalendar {
  externalId: string;
  name: string;
}

interface ExistingCalendar {
  id: string;
  externalCalendarId: string | null;
  providerMissingSince: Date | null;
  createdAt: Date;
}

interface ReconciliationOptions {
  enumerationStartedAt?: Date;
  removedExternalIds?: ReadonlySet<string>;
}

interface RefreshAccountCalendarsResult {
  imported: number;
  missing: number;
  restored: number;
}

interface AccountCredentials {
  provider: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface ReconciliationPlan {
  toInsert: ExternalCalendar[];
  toMarkMissing: string[];
  toRestore: string[];
}

/**
 * Pure diff between what the provider currently reports and what we already imported. Kept
 * separate from I/O so the reconciliation rules (import new, flag missing, restore returned) are
 * unit-testable without a database. Calendars no longer reported by the provider are flagged via
 * providerMissingSince rather than disabled outright - silently auto-disabling on a single
 * listing was tried before and caused false positives, so the user decides via the manual
 * disable toggle once they see the flag.
 */
const predatesEnumeration = (
  calendar: ExistingCalendar,
  enumerationStartedAt: Date | undefined,
): boolean =>
  !enumerationStartedAt
  || calendar.createdAt.getTime() <= enumerationStartedAt.getTime();

const reconcileAccountCalendars = (
  providerCalendars: ExternalCalendar[],
  existingCalendars: ExistingCalendar[],
  options: ReconciliationOptions = {},
): ReconciliationPlan => {
  if (providerCalendars.length === 0 && existingCalendars.length > 0) {
    return { toInsert: [], toMarkMissing: [], toRestore: [] };
  }

  const providerExternalIds = new Set(providerCalendars.map((calendar) => calendar.externalId));
  const existingExternalIds = new Set(
    existingCalendars.map((calendar) => calendar.externalCalendarId),
  );

  const removedExternalIds = options.removedExternalIds ?? new Set<string>();

  const toInsert = providerCalendars.filter(
    (calendar) =>
      !existingExternalIds.has(calendar.externalId)
      && !removedExternalIds.has(calendar.externalId),
  );

  const toMarkMissing: string[] = [];
  const toRestore: string[] = [];

  for (const calendar of existingCalendars) {
    const stillPresent = calendar.externalCalendarId !== null
      && providerExternalIds.has(calendar.externalCalendarId);

    if (stillPresent) {
      if (calendar.providerMissingSince) {
        toRestore.push(calendar.id);
      }
      continue;
    }

    if (!calendar.providerMissingSince && predatesEnumeration(calendar, options.enumerationStartedAt)) {
      toMarkMissing.push(calendar.id);
    }
  }

  return { toInsert, toMarkMissing, toRestore };
};

const toRemovedExternalId = (externalCalendarId: string | null): string[] => {
  if (!externalCalendarId) {
    return [];
  }
  return [externalCalendarId];
};

const isExpired = (expiresAt: Date): boolean => expiresAt < new Date();

const getValidAccessToken = async (
  accountId: string,
  credentials: AccountCredentials,
): Promise<string> => {
  if (!isExpired(credentials.expiresAt)) {
    return credentials.accessToken;
  }

  const { refreshGoogleAccessToken, refreshMicrosoftAccessToken } = await import("./oauth-refresh");

  if (credentials.provider === "google") {
    const refreshed = await refreshGoogleAccessToken(accountId, credentials.refreshToken);
    return refreshed.accessToken;
  }

  if (credentials.provider === "outlook") {
    const refreshed = await refreshMicrosoftAccessToken(accountId, credentials.refreshToken);
    return refreshed.accessToken;
  }

  throw new Error(`No token refresh support for provider: ${credentials.provider}`);
};

const listProviderCalendars = async (
  provider: string,
  accessToken: string,
): Promise<ExternalCalendar[]> => {
  if (provider === "google") {
    const calendars = await listGoogleCalendars(accessToken);
    return calendars.map((calendar) => ({ externalId: calendar.id, name: calendar.summary }));
  }

  if (provider === "outlook") {
    const calendars = await listOutlookCalendars(accessToken);
    return calendars.map((calendar) => ({ externalId: calendar.id, name: calendar.name }));
  }

  throw new Error(`No calendar listing support for provider: ${provider}`);
};

const refreshAccountCalendars = async (
  userId: string,
  accountId: string,
): Promise<RefreshAccountCalendarsResult> => {
  const { database } = await import("@/context");

  const [account] = await database
    .select({
      email: oauthCredentialsTable.email,
      accessToken: oauthCredentialsTable.accessToken,
      expiresAt: oauthCredentialsTable.expiresAt,
      provider: calendarAccountsTable.provider,
      refreshToken: oauthCredentialsTable.refreshToken,
    })
    .from(calendarAccountsTable)
    .innerJoin(
      oauthCredentialsTable,
      eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .where(
      and(
        eq(calendarAccountsTable.id, accountId),
        eq(calendarAccountsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (!account) {
    throw new AccountNotFoundError();
  }

  const accessToken = await getValidAccessToken(accountId, account);
  const enumerationStartedAt = new Date();
  const providerCalendars = await listProviderCalendars(account.provider, accessToken);

  const existingCalendars = await database
    .select({
      createdAt: calendarsTable.createdAt,
      externalCalendarId: calendarsTable.externalCalendarId,
      id: calendarsTable.id,
      providerMissingSince: calendarsTable.providerMissingSince,
    })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.accountId, accountId),
        eq(calendarsTable.userId, userId),
      ),
    );

  const removedRows = await database
    .select({ externalCalendarId: calendarRemovalsTable.externalCalendarId })
    .from(calendarRemovalsTable)
    .where(
      and(
        eq(calendarRemovalsTable.accountId, accountId),
        eq(calendarRemovalsTable.userId, userId),
        eq(calendarRemovalsTable.calendarType, OAUTH_CALENDAR_TYPE),
        isNotNull(calendarRemovalsTable.externalCalendarId),
      ),
    );

  const { toInsert, toMarkMissing, toRestore } = reconcileAccountCalendars(
    providerCalendars,
    existingCalendars,
    {
      enumerationStartedAt,
      removedExternalIds: new Set(
        removedRows.flatMap((row) => toRemovedExternalId(row.externalCalendarId)),
      ),
    },
  );

  if (toInsert.length > 0) {
    await insertSourceCalendars(
      createSourceCalendarInsertDependencies(database),
      userId,
      toInsert.map((calendar) => ({
        accountId,
        calendarType: OAUTH_CALENDAR_TYPE,
        capabilities: ["pull", "push"],
        externalCalendarId: calendar.externalId,
        name: calendar.name,
        originalName: calendar.name,
        userId,
      })),
    );
  }

  for (const calendarId of toMarkMissing) {
    await database
      .update(calendarsTable)
      .set({ providerMissingSince: new Date() })
      .where(eq(calendarsTable.id, calendarId));
  }

  for (const calendarId of toRestore) {
    await database
      .update(calendarsTable)
      .set({ providerMissingSince: null })
      .where(eq(calendarsTable.id, calendarId));
  }

  return { imported: toInsert.length, missing: toMarkMissing.length, restored: toRestore.length };
};

export { reconcileAccountCalendars, refreshAccountCalendars, AccountNotFoundError };
export type { RefreshAccountCalendarsResult, ExternalCalendar, ExistingCalendar, ReconciliationPlan };
