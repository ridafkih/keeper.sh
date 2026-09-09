import { calendarAccountsTable, caldavCredentialsTable } from "@keeper.sh/database/schema";
import { encryptPassword } from "@keeper.sh/database";
import { and, eq } from "drizzle-orm";
import type { KeeperDatabase } from "@/types";

const FIRST_RESULT_LIMIT = 1;

interface CalDAVReconnectTarget {
  accountId: string;
  credentialId: string;
  serverUrl: string;
  username: string;
}

class ReconnectNotSupportedError extends Error {}

/**
 * CalDAV has no refresh token to renew, so restoring access means replacing the stored
 * password. Server URL and username stay as they are — changing them would point the
 * account at a different mailbox rather than repair this one.
 */
const getCalDAVReconnectTarget = async (
  database: KeeperDatabase,
  userId: string,
  accountId: string,
): Promise<CalDAVReconnectTarget | null> => {
  const [row] = await database
    .select({
      accountId: calendarAccountsTable.id,
      authType: calendarAccountsTable.authType,
      credentialId: caldavCredentialsTable.id,
      serverUrl: caldavCredentialsTable.serverUrl,
      username: caldavCredentialsTable.username,
    })
    .from(calendarAccountsTable)
    .innerJoin(
      caldavCredentialsTable,
      eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
    )
    .where(
      and(
        eq(calendarAccountsTable.id, accountId),
        eq(calendarAccountsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (!row) {
    return null;
  }

  if (row.authType !== "caldav") {
    throw new ReconnectNotSupportedError("Account does not use CalDAV credentials");
  }

  return {
    accountId: row.accountId,
    credentialId: row.credentialId,
    serverUrl: row.serverUrl,
    username: row.username,
  };
};

const applyCalDAVReconnect = async (
  database: KeeperDatabase,
  target: CalDAVReconnectTarget,
  password: string,
  authMethod: "basic" | "digest",
): Promise<void> => {
  /* Imported lazily: evaluating @/context at module scope boots auth, which a unit test
     importing this file has no way to satisfy. */
  const { encryptionKey } = await import("@/context");

  if (!encryptionKey) {
    throw new Error("Encryption key not configured");
  }

  const encryptedPassword = encryptPassword(password, encryptionKey);

  await database.transaction(async (transaction) => {
    await transaction
      .update(caldavCredentialsTable)
      .set({ authMethod, encryptedPassword })
      .where(eq(caldavCredentialsTable.id, target.credentialId));

    await transaction
      .update(calendarAccountsTable)
      .set({ needsReauthentication: false, reauthenticationSource: null })
      .where(eq(calendarAccountsTable.id, target.accountId));
  });
};

export { applyCalDAVReconnect, getCalDAVReconnectTarget, ReconnectNotSupportedError };
export type { CalDAVReconnectTarget };
