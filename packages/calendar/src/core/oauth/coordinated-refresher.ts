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
import { classifyDatabaseError } from "@keeper.sh/database";
import { widelog } from "widelogger";
import { abortableSleep } from "../utils/backoff";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const MS_PER_SECOND = 1000;

/*
 * The provider has already rotated by the time this write runs, so a lost write costs the only
 * copy of the new refresh token. Retried here rather than through withBackoff, which charges
 * provider retry counters that a database write has no business moving.
 */
const PERSIST_ATTEMPTS = 3;
const PERSIST_BACKOFF_MS = 50;

interface RefreshedCredential {
  accessToken: string;
  expiresAt: Date;
  refreshToken: string;
}

const persistRefreshedCredential = async (
  database: BunSQLDatabase,
  oauthCredentialId: string,
  credential: RefreshedCredential,
): Promise<void> => {
  for (let attempt = 1; attempt <= PERSIST_ATTEMPTS; attempt++) {
    try {
      await database
        .update(oauthCredentialsTable)
        .set(credential)
        .where(eq(oauthCredentialsTable.id, oauthCredentialId));
      widelog.set("token.persist_attempts", attempt);
      return;
    } catch (error) {
      const isTransient = classifyDatabaseError(error) !== null;
      if (attempt === PERSIST_ATTEMPTS || !isTransient) {
        widelog.set("token.persist_attempts", attempt);
        throw error;
      }
      await abortableSleep(PERSIST_BACKOFF_MS * attempt);
    }
  }
};

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
          const rotated = typeof result.refresh_token === "string"
            && result.refresh_token !== refreshToken;

          try {
            await persistRefreshedCredential(database, oauthCredentialId, {
              accessToken: result.access_token,
              expiresAt: newExpiresAt,
              refreshToken: result.refresh_token ?? refreshToken,
            });
          } catch (error) {
            /*
             * A failed write is ambiguous: it may have committed with only the acknowledgement
             * lost, so the credential is not marked for reauthentication here. The next refresh
             * asks the provider, which answers definitively. Only a rotated token is actually
             * lost — without rotation the stored refresh token still works.
             */
            widelog.set("token.rotation_lost", rotated);
            throw error;
          }

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
