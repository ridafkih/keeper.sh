import { calendarAccountsTable } from "@keeper.sh/database/schema";
import { createCalDAVClient } from "@keeper.sh/calendar/caldav";
import { encryptPassword } from "@keeper.sh/database";
import { isCalDAVProvider } from "@keeper.sh/calendar";
import type { CalDAVProviderId } from "@keeper.sh/calendar";
import { and, eq, sql } from "drizzle-orm";
import { saveCalDAVDestinationWithDatabase } from "./destinations";
import { enqueuePushSync } from "./enqueue-push-sync";
import { safeFetchOptions } from "./safe-fetch-options";
import { database, encryptionKey, premiumService } from "@/context";

const USER_ACCOUNT_LOCK_NAMESPACE = 9002;

class DestinationLimitError extends Error {
  constructor() {
    super("Account limit reached. Upgrade to Unlimited for unlimited accounts.");
  }
}

class CalDAVConnectionError extends Error {
  constructor(cause?: unknown) {
    super("Failed to connect. Check credentials and server URL.");
    this.cause = cause;
  }
}

interface CalDAVCredentials {
  username: string;
  password: string;
}

interface DiscoveredCalendar {
  url: string;
  displayName: string | undefined;
}

const isValidProvider = (provider: string): provider is CalDAVProviderId =>
  isCalDAVProvider(provider);

const discoverCalendars = async (
  serverUrl: string,
  credentials: CalDAVCredentials,
): Promise<DiscoveredCalendar[]> => {
  try {
    const client = createCalDAVClient({
      credentials,
      serverUrl,
    }, safeFetchOptions);

    const calendars = await client.discoverCalendars();

    return calendars.map((calendar) => ({
      displayName: calendar.displayName,
      url: calendar.url,
    }));
  } catch (error) {
    throw new CalDAVConnectionError(error);
  }
};

const validateCredentials = async (
  serverUrl: string,
  credentials: CalDAVCredentials,
): Promise<void> => {
  const client = createCalDAVClient({
    credentials,
    serverUrl,
  });

  await client.discoverCalendars();
};

const createCalDAVDestination = async (
  userId: string,
  provider: CalDAVProviderId,
  serverUrl: string,
  credentials: CalDAVCredentials,
  calendarUrl: string,
): Promise<void> => {
  try {
    await validateCredentials(serverUrl, credentials);
  } catch (error) {
    throw new CalDAVConnectionError(error);
  }

  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY must be set to use CalDAV destinations");
  }

  const encrypted = encryptPassword(credentials.password, encryptionKey);
  const serverHost = new URL(serverUrl).host;
  const accountId = `${credentials.username}@${serverHost}`;

  await database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${USER_ACCOUNT_LOCK_NAMESPACE}, hashtext(${userId}))`,
    );

    const [existingAccount] = await tx
      .select({ id: calendarAccountsTable.id })
      .from(calendarAccountsTable)
      .where(
        and(
          eq(calendarAccountsTable.userId, userId),
          eq(calendarAccountsTable.provider, provider),
          eq(calendarAccountsTable.accountId, accountId),
        ),
      )
      .limit(1);

    if (!existingAccount) {
      const existingAccounts = await tx
        .select({ id: calendarAccountsTable.id })
        .from(calendarAccountsTable)
        .where(eq(calendarAccountsTable.userId, userId));

      const allowed = await premiumService.canAddAccount(userId, existingAccounts.length);
      if (!allowed) {
        throw new DestinationLimitError();
      }
    }

    await saveCalDAVDestinationWithDatabase(
      tx,
      userId,
      provider,
      accountId,
      credentials.username,
      serverUrl,
      calendarUrl,
      credentials.username,
      encrypted,
    );
  });

  const plan = await premiumService.getUserPlan(userId);
  if (!plan) {
    throw new Error("Unable to resolve user plan for sync enqueue");
  }
  await enqueuePushSync(userId, plan);
};

const extractServerHost = (serverUrl: string): string | null => {
  try {
    return new URL(serverUrl).host;
  } catch {
    return null;
  }
};

export {
  DestinationLimitError,
  CalDAVConnectionError,
  extractServerHost,
  isValidProvider,
  discoverCalendars,
  createCalDAVDestination,
};
