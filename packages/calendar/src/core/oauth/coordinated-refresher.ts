import type { CredentialRefreshResult, RefreshLockStore } from "./refresh-coordinator";
import { runWithCredentialRefreshLock } from "./refresh-coordinator";
import { withReauthenticationDemand } from "../reauthentication/reauthentication-demand";
import { RotatedTokenNotPersistedError } from "./rotated-token-not-persisted";
import { oauthCredentialsTable } from "@keeper.sh/database/schema";
import { TOKEN_REFRESH_BUFFER_MS } from "@keeper.sh/constants";
import { classifyDatabaseError } from "@keeper.sh/database";
import { widelog } from "widelogger";
import { abortableSleep } from "../utils/backoff";
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

const MS_PER_SECOND = 1000;

const PERSIST_ATTEMPTS = 3;
const PERSIST_BACKOFF_MS = 50;
const REFRESH_WALL_BUDGET_MS = 20_000;

class RefreshBudgetExceededError extends Error {
  constructor(budgetMs: number) {
    super(`token refresh exceeded its ${budgetMs}ms wall-time budget`);
    this.name = "RefreshBudgetExceededError";
  }
}

const withRefreshDeadline = <Result>(
  budgetMs: number,
  run: (signal: AbortSignal) => Promise<Result>,
): Promise<Result> => {
  const signal = AbortSignal.timeout(budgetMs);
  const expiry = new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(new RefreshBudgetExceededError(budgetMs)),
      { once: true },
    );
  });

  return Promise.race([run(signal), expiry]);
};

interface RefreshedCredential {
  accessToken: string;
  expiresAt: Date;
  refreshToken: string;
}

const persistRefreshedCredential = async (
  database: PgDatabase<PgQueryResultHKT>,
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

const persistRotatedCredential = async (
  database: PgDatabase<PgQueryResultHKT>,
  oauthCredentialId: string,
  previousRefreshToken: string,
  result: { access_token: string; expires_in: number; refresh_token?: string },
): Promise<void> => {
  const rotated = typeof result.refresh_token === "string"
    && result.refresh_token !== previousRefreshToken;

  try {
    await persistRefreshedCredential(database, oauthCredentialId, {
      accessToken: result.access_token,
      expiresAt: new Date(Date.now() + result.expires_in * MS_PER_SECOND),
      refreshToken: result.refresh_token ?? previousRefreshToken,
    });
  } catch (error) {
    widelog.set("token.rotation_lost", rotated);
    if (rotated) {
      throw new RotatedTokenNotPersistedError(error);
    }
    throw error;
  }
};

interface CoordinatedRefresherOptions {
  acquireBudgetMs?: number;
  database: PgDatabase<PgQueryResultHKT>;
  oauthCredentialId: string;
  calendarAccountId: string;
  refreshLockStore: RefreshLockStore | null;
  rawRefresh: (
    refreshToken: string,
    options?: { signal?: AbortSignal },
  ) => Promise<{
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  }>;
  refreshBudgetMs?: number;
}

const createCoordinatedRefresher = (options: CoordinatedRefresherOptions) => {
  const {
    acquireBudgetMs,
    database,
    oauthCredentialId,
    calendarAccountId,
    refreshLockStore,
    rawRefresh,
    refreshBudgetMs = REFRESH_WALL_BUDGET_MS,
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
      () =>
        withReauthenticationDemand(database, { calendarAccountId }, async () => {
          const result = await withRefreshDeadline(
            refreshBudgetMs,
            (signal) => rawRefresh(refreshToken, { signal }),
          );

          await persistRotatedCredential(database, oauthCredentialId, refreshToken, result);

          return result;
        }),
      refreshLockStore,
      readFreshCredential,
      acquireBudgetMs,
    );
};

export {
  REFRESH_WALL_BUDGET_MS,
  RefreshBudgetExceededError,
  RotatedTokenNotPersistedError,
  createCoordinatedRefresher,
  persistRefreshedCredential,
  persistRotatedCredential,
};
export type { CoordinatedRefresherOptions, RefreshedCredential };
