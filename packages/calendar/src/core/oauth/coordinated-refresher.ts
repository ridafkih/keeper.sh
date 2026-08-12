import type { RefreshLockStore } from "./refresh-coordinator";
import { runWithCredentialRefreshLock } from "./refresh-coordinator";
import { isOAuthReauthRequiredError } from "./error-classification";
import {
  calendarAccountsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const MS_PER_SECOND = 1000;

interface CoordinatedRefresherOptions {
  database: BunSQLDatabase;
  oauthCredentialId: string;
  calendarAccountId: string;
  refreshLockStore: RefreshLockStore | null;
  rawRefresh: (refreshToken: string) => Promise<{
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  }>;
}

const createCoordinatedRefresher = (options: CoordinatedRefresherOptions) => {
  const { database, oauthCredentialId, calendarAccountId, refreshLockStore, rawRefresh } = options;

  return (refreshToken: string) =>
    runWithCredentialRefreshLock(
      oauthCredentialId,
      async () => {
        try {
          const result = await rawRefresh(refreshToken);

          const newExpiresAt = new Date(Date.now() + result.expires_in * MS_PER_SECOND);

          await database
            .update(oauthCredentialsTable)
            .set({
              accessToken: result.access_token,
              expiresAt: newExpiresAt,
              refreshToken: result.refresh_token ?? refreshToken,
            })
            .where(eq(oauthCredentialsTable.id, oauthCredentialId));

          // A successful refresh proves the account no longer needs reauth. Clear
          // the account-level latch so a healthy token doesn't stay flagged forever
          // (MA-423): the failure branch below sets this TRUE, but until now no
          // success branch ever reset it.
          await database
            .update(calendarAccountsTable)
            .set({ needsReauthentication: false })
            .where(
              and(
                eq(calendarAccountsTable.id, calendarAccountId),
                eq(calendarAccountsTable.needsReauthentication, true),
              ),
            );

          return result;
        } catch (error) {
          if (isOAuthReauthRequiredError(error)) {
            await database
              .update(calendarAccountsTable)
              .set({ needsReauthentication: true })
              .where(eq(calendarAccountsTable.id, calendarAccountId));
          }
          throw error;
        }
      },
      refreshLockStore,
    );
};

export { createCoordinatedRefresher };
export type { CoordinatedRefresherOptions };
