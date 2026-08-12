import type { RefreshLockStore } from "./refresh-coordinator";
import { runWithCredentialRefreshLock } from "./refresh-coordinator";
import { isOAuthReauthRequiredError } from "./error-classification";
import { encryptToken } from "@keeper.sh/database";
import {
  calendarAccountsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const MS_PER_SECOND = 1000;

interface CoordinatedRefresherOptions {
  database: BunSQLDatabase;
  oauthCredentialId: string;
  calendarAccountId: string;
  encryptionKey: string;
  refreshLockStore: RefreshLockStore | null;
  rawRefresh: (refreshToken: string) => Promise<{
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  }>;
}

const createCoordinatedRefresher = (options: CoordinatedRefresherOptions) => {
  const {
    database,
    oauthCredentialId,
    calendarAccountId,
    encryptionKey,
    refreshLockStore,
    rawRefresh,
  } = options;

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
              accessToken: encryptToken(result.access_token, encryptionKey),
              expiresAt: newExpiresAt,
              refreshToken: encryptToken(result.refresh_token ?? refreshToken, encryptionKey),
            })
            .where(eq(oauthCredentialsTable.id, oauthCredentialId));

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
