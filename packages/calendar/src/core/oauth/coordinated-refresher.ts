import type { CredentialRefreshResult, RefreshLockStore } from "./refresh-coordinator";
import { runWithCredentialRefreshLock } from "./refresh-coordinator";
import { withReauthenticationDemand } from "../reauthentication/reauthentication-demand";
import { RotatedTokenNotPersistedError } from "./rotated-token-not-persisted";
import { RefreshBudgetExceededError } from "./refresh-budget-exceeded";
import { CredentialRowMissingError } from "./credential-row-missing";
import { oauthCredentialsTable } from "@keeper.sh/database/schema";
import { TOKEN_REFRESH_BUFFER_MS } from "@keeper.sh/constants";
import { classifyDatabaseError } from "@keeper.sh/database";
import { widelog } from "widelogger";
import { abortableSleep } from "../utils/backoff";
import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

const MS_PER_SECOND = 1000;

const PERSIST_ATTEMPTS = 3;
const PERSIST_BACKOFF_MS = 50;
const REFRESH_WALL_BUDGET_MS = 20_000;
const REFRESH_REQUEST_HARD_CAP_MS = 45_000;

const withAbandonableRequest = <Result>(
  budgetSignal: AbortSignal,
  requestSignal: AbortSignal,
  run: (signal: AbortSignal) => Promise<Result>,
  onAbandonedResult: (result: Result) => Promise<void>,
  whenBudgetExceeded: (inFlightAttempt: Promise<Result>) => Error,
): Promise<Result> => {
  const abandonment = { abandoned: false };
  const attempt = run(requestSignal);
  const observed = (async () => {
    try {
      const result = await attempt;
      if (abandonment.abandoned) {
        await onAbandonedResult(result);
      }
      return result;
    } catch (error) {
      if (abandonment.abandoned) {
        widelog.error("token.abandoned_refresh", error);
      }
      throw error;
    }
  })();

  const expiry = new Promise<never>((_resolve, reject) => {
    const abandon = () => {
      abandonment.abandoned = true;
      reject(whenBudgetExceeded(observed));
    };

    if (budgetSignal.aborted) {
      abandon();
      return;
    }

    budgetSignal.addEventListener("abort", abandon, { once: true });
  });

  return Promise.race([observed, expiry]);
};

const withRefreshDeadline = <Result>(
  budgetMs: number,
  hardCapMs: number,
  run: (signal: AbortSignal) => Promise<Result>,
  onAbandonedResult: (result: Result) => Promise<void>,
): Promise<Result> => {
  if (hardCapMs <= budgetMs) {
    throw new Error(
      `refresh hard cap ${hardCapMs}ms must be strictly longer than the ${budgetMs}ms wall budget`,
    );
  }

  return withAbandonableRequest(
    AbortSignal.timeout(budgetMs),
    AbortSignal.timeout(hardCapMs),
    run,
    onAbandonedResult,
    (inFlightAttempt) => new RefreshBudgetExceededError(budgetMs, inFlightAttempt),
  );
};

interface RefreshedCredential {
  accessToken: string;
  expiresAt: Date;
  refreshToken: string;
}

const affectedRowCount = (outcome: unknown): number => {
  const candidate = outcome as { count?: unknown; rowCount?: unknown; rowsAffected?: unknown };
  for (const value of [candidate?.rowCount, candidate?.rowsAffected, candidate?.count]) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  throw new Error("credential update returned no affected row count");
};

const persistRefreshedCredential = async (
  database: PgDatabase<PgQueryResultHKT>,
  oauthCredentialId: string,
  credential: RefreshedCredential,
): Promise<void> => {
  for (let attempt = 1; attempt <= PERSIST_ATTEMPTS; attempt++) {
    try {
      const outcome = await database
        .update(oauthCredentialsTable)
        .set(credential)
        .where(eq(oauthCredentialsTable.id, oauthCredentialId));
      widelog.set("token.persist_attempts", attempt);
      if (affectedRowCount(outcome) === 0) {
        throw new CredentialRowMissingError(oauthCredentialId);
      }
      return;
    } catch (error) {
      if (error instanceof CredentialRowMissingError) {
        throw error;
      }
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

type AbandonedRotationOutcome = "lost" | "nothing-to-adopt" | "recovered";

const persistAbandonedRotation = async (
  database: PgDatabase<PgQueryResultHKT>,
  oauthCredentialId: string,
  presentedRefreshToken: string,
  result: { access_token: string; expires_in: number; refresh_token?: string },
): Promise<AbandonedRotationOutcome> => {
  if (
    typeof result.refresh_token !== "string"
    || result.refresh_token === presentedRefreshToken
  ) {
    return "nothing-to-adopt";
  }

  const outcome = await database
    .update(oauthCredentialsTable)
    .set({
      accessToken: result.access_token,
      expiresAt: new Date(Date.now() + result.expires_in * MS_PER_SECOND),
      refreshToken: result.refresh_token,
    })
    .where(
      and(
        eq(oauthCredentialsTable.id, oauthCredentialId),
        eq(oauthCredentialsTable.refreshToken, presentedRefreshToken),
      ),
    );

  if (affectedRowCount(outcome) === 0) {
    return "lost";
  }

  return "recovered";
};

const adoptAbandonedRotation = async (
  database: PgDatabase<PgQueryResultHKT>,
  oauthCredentialId: string,
  presentedRefreshToken: string,
  result: { access_token: string; expires_in: number; refresh_token?: string },
): Promise<void> => {
  const outcome = await persistAbandonedRotation(
    database,
    oauthCredentialId,
    presentedRefreshToken,
    result,
  );

  if (outcome === "lost") {
    widelog.set("token.rotation_lost", true);
    return;
  }

  if (outcome === "recovered") {
    widelog.set("token.rotation_recovered", true);
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
  refreshHardCapMs?: number;
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
    refreshHardCapMs = REFRESH_REQUEST_HARD_CAP_MS,
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
            refreshHardCapMs,
            (signal) => rawRefresh(refreshToken, { signal }),
            (abandoned) =>
              adoptAbandonedRotation(database, oauthCredentialId, refreshToken, abandoned),
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
  CredentialRowMissingError,
  REFRESH_REQUEST_HARD_CAP_MS,
  REFRESH_WALL_BUDGET_MS,
  RefreshBudgetExceededError,
  RotatedTokenNotPersistedError,
  adoptAbandonedRotation,
  createCoordinatedRefresher,
  persistAbandonedRotation,
  persistRefreshedCredential,
  persistRotatedCredential,
  withAbandonableRequest,
  withRefreshDeadline,
};
export type { AbandonedRotationOutcome, CoordinatedRefresherOptions, RefreshedCredential };
