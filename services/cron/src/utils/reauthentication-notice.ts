import {
  REAUTHENTICATION_EMAIL_BATCH_SIZE,
  REAUTHENTICATION_EMAIL_GRACE_MS,
  REAUTHENTICATION_RECONNECT_PATH,
} from "@keeper.sh/constants";
import { getProvider } from "@keeper.sh/calendar";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { calendarAccountsTable } from "@keeper.sh/database/schema";
import { user as userTable } from "@keeper.sh/database/auth-schema";
import { and, eq, isNotNull, isNull, lte, or } from "drizzle-orm";

interface ReauthenticationEmailConfig {
  linkBaseUrl: string;
  resendApiKey: string;
  templateId: string;
}

interface ReauthenticationEmailEnvironment {
  BETTER_AUTH_URL?: string;
  REAUTHENTICATION_EMAIL_TEMPLATE_ID?: string;
  RESEND_API_KEY?: string;
}

/*
 * The email is on only when its template is configured, and then it must be able to send and
 * link: a template without a Resend key or a base URL stops the service at startup.
 */
const resolveReauthenticationEmailConfig = (
  environment: ReauthenticationEmailEnvironment,
): ReauthenticationEmailConfig | null => {
  const templateId = environment.REAUTHENTICATION_EMAIL_TEMPLATE_ID;
  if (!templateId) {
    return null;
  }
  const resendApiKey = environment.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error("REAUTHENTICATION_EMAIL_TEMPLATE_ID is set but RESEND_API_KEY is not");
  }
  const linkBaseUrl = environment.BETTER_AUTH_URL;
  if (!linkBaseUrl) {
    throw new Error("REAUTHENTICATION_EMAIL_TEMPLATE_ID is set but BETTER_AUTH_URL is not");
  }
  return { linkBaseUrl, resendApiKey, templateId };
};

interface ReauthenticationEmail {
  template: {
    id: string;
    variables: {
      accountLabel: string;
      name: string;
      provider: string;
      url: string;
    };
  };
  to: string;
}

type SendReauthenticationEmail = (email: ReauthenticationEmail) => Promise<void>;

interface ReauthenticationNoticeDependencies {
  database: BunSQLDatabase;
  linkBaseUrl: string;
  now: Date;
  send: SendReauthenticationEmail;
  templateId: string;
}

interface ReauthenticationNoticeResult {
  failures: unknown[];
  sent: number;
}

const buildReconnectUrl = (linkBaseUrl: string, accountId: string): string =>
  new URL(REAUTHENTICATION_RECONNECT_PATH.replace(":accountId", accountId), linkBaseUrl).href;

const resolveProviderName = (provider: string): string => getProvider(provider)?.name ?? provider;

const clearRecoveredAccounts = (database: BunSQLDatabase) =>
  database
    .update(calendarAccountsTable)
    .set({ reauthenticationNotifiedAt: null, reauthenticationObservedAt: null })
    .where(and(
      eq(calendarAccountsTable.needsReauthentication, false),
      or(
        isNotNull(calendarAccountsTable.reauthenticationNotifiedAt),
        isNotNull(calendarAccountsTable.reauthenticationObservedAt),
      ),
    ));

const observeFlaggedAccounts = (database: BunSQLDatabase, now: Date) =>
  database
    .update(calendarAccountsTable)
    .set({ reauthenticationObservedAt: now })
    .where(and(
      eq(calendarAccountsTable.needsReauthentication, true),
      isNull(calendarAccountsTable.reauthenticationObservedAt),
    ));

const selectDueAccounts = (database: BunSQLDatabase, now: Date) =>
  database
    .select({
      accountId: calendarAccountsTable.id,
      accountDisplayName: calendarAccountsTable.displayName,
      accountEmail: calendarAccountsTable.email,
      provider: calendarAccountsTable.provider,
      userEmail: userTable.email,
      userName: userTable.name,
    })
    .from(calendarAccountsTable)
    .innerJoin(userTable, eq(userTable.id, calendarAccountsTable.userId))
    .where(and(
      eq(calendarAccountsTable.needsReauthentication, true),
      isNull(calendarAccountsTable.reauthenticationNotifiedAt),
      lte(
        calendarAccountsTable.reauthenticationObservedAt,
        new Date(now.getTime() - REAUTHENTICATION_EMAIL_GRACE_MS),
      ),
      eq(userTable.emailVerified, true),
    ))
    .limit(REAUTHENTICATION_EMAIL_BATCH_SIZE);

const claimNotice = async (
  database: BunSQLDatabase,
  accountId: string,
  now: Date,
): Promise<boolean> => {
  const claimed = await database
    .update(calendarAccountsTable)
    .set({ reauthenticationNotifiedAt: now })
    .where(and(
      eq(calendarAccountsTable.id, accountId),
      eq(calendarAccountsTable.needsReauthentication, true),
      isNull(calendarAccountsTable.reauthenticationNotifiedAt),
    ))
    .returning({ id: calendarAccountsTable.id });
  return claimed.length > 0;
};

const releaseNotice = (database: BunSQLDatabase, accountId: string, now: Date) =>
  database
    .update(calendarAccountsTable)
    .set({ reauthenticationNotifiedAt: null })
    .where(and(
      eq(calendarAccountsTable.id, accountId),
      eq(calendarAccountsTable.reauthenticationNotifiedAt, now),
    ));

/*
 * One email per time an account is flagged: the notice is claimed before sending so two cron
 * instances never both send it, released if the send fails so the next run retries, and
 * cleared once the account works again so the next flag sends a new one.
 */
const runReauthenticationNotices = async (
  dependencies: ReauthenticationNoticeDependencies,
): Promise<ReauthenticationNoticeResult> => {
  const { database, linkBaseUrl, now, send, templateId } = dependencies;
  await clearRecoveredAccounts(database);
  await observeFlaggedAccounts(database, now);

  const result: ReauthenticationNoticeResult = { failures: [], sent: 0 };
  for (const account of await selectDueAccounts(database, now)) {
    if (!await claimNotice(database, account.accountId, now)) {
      continue;
    }
    try {
      await send({
        template: {
          id: templateId,
          variables: {
            accountLabel: account.accountEmail ?? account.accountDisplayName ?? "",
            name: account.userName,
            provider: resolveProviderName(account.provider),
            url: buildReconnectUrl(linkBaseUrl, account.accountId),
          },
        },
        to: account.userEmail,
      });
      result.sent += 1;
    } catch (error) {
      await releaseNotice(database, account.accountId, now);
      result.failures.push(error);
    }
  }
  return result;
};

export { buildReconnectUrl, resolveReauthenticationEmailConfig, runReauthenticationNotices };
export type {
  ReauthenticationEmail,
  ReauthenticationEmailConfig,
  ReauthenticationNoticeDependencies,
  ReauthenticationNoticeResult,
  SendReauthenticationEmail,
};
