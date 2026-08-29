import type { CredentialRefreshResult, RefreshLockStore } from "./refresh-coordinator";
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
import { REAUTHENTICATION_TOKEN_REFRESH, TOKEN_REFRESH_BUFFER_MS } from "@keeper.sh/constants";
import { classifyDatabaseError } from "@keeper.sh/database";
import { widelog } from "widelogger";
import { abortableSleep } from "../utils/backoff";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const MS_PER_SECOND = 1000;

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
  acquireBudgetMs?: number;
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
  const {
    acquireBudgetMs,
    database,
    oauthCredentialId,
    calendarAccountId,
    refreshLockStore,
    rawRefresh,
  } = options;

  /*
   * A peer that won the lock persists before releasing it, so its result is readable here.
   * Refreshing again would rotate the refresh token out from under it.
   */
  const readFreshCredential = async (): Promise<CredentialRefreshResult | null> => {
    const [stored] = await database
      .select({
        accessToken: oauthCredentialsTable.accessToken,
        expiresAt: oauthCredentialsTable.expiresAt,
      })
      .from(oauthCredentialsTable)
      .where(eq(oauthCredentialsTable.id, oauthCredentialId))
      .limit(1);
    if (!stored?.expiresAt || !stored.accessToken) {
      return null;
    }
    /*
     * The caller refreshes whenever less than TOKEN_REFRESH_BUFFER_MS remains, so adopting
     * anything shorter hands back a credential it will immediately try to refresh again.
     */
    const remainingMs = stored.expiresAt.getTime() - Date.now();
    if (remainingMs <= TOKEN_REFRESH_BUFFER_MS) {
      return null;
    }
    return {
      access_token: stored.accessToken,
      expires_in: Math.floor(remainingMs / MS_PER_SECOND),
    };
  };

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
      readFreshCredential,
      acquireBudgetMs,
    );
};

export { createCoordinatedRefresher };
export type { CoordinatedRefresherOptions };
