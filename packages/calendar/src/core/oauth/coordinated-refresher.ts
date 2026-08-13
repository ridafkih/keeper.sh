import type { RefreshLockStore } from "./refresh-coordinator";
import { runWithCredentialRefreshLock } from "./refresh-coordinator";
import { isOAuthReauthRequiredError } from "./error-classification";
import {
  readPriorReauthenticationState,
  recordReauthenticationDemand,
} from "../reauthentication/demand-telemetry";
import {
  calendarAccountsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { REAUTHENTICATION_TOKEN_REFRESH } from "@keeper.sh/constants";
import { eq } from "drizzle-orm";
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

          return result;
        } catch (error) {
          if (isOAuthReauthRequiredError(error)) {
            const prior = await readPriorReauthenticationState(database, calendarAccountId);
            await database
              .update(calendarAccountsTable)
              .set({
                needsReauthentication: true,
                reauthenticationSource: REAUTHENTICATION_TOKEN_REFRESH,
              })
              .where(eq(calendarAccountsTable.id, calendarAccountId));
            recordReauthenticationDemand({
              accountId: calendarAccountId,
              action: "raise",
              previous: prior?.needsReauthentication ?? null,
              provenance: REAUTHENTICATION_TOKEN_REFRESH,
              recordedProvenance: prior?.reauthenticationSource,
              signal: "oauth-refresh-rejected",
            });
          }
          throw error;
        }
      },
      refreshLockStore,
    );
};

export { createCoordinatedRefresher };
export type { CoordinatedRefresherOptions };
