import { widelog } from "widelogger";

interface CredentialRefreshResult {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

type ReadFreshCredential = () => Promise<CredentialRefreshResult | null>;

interface RefreshLockStore {
  tryAcquire(key: string, ttlSeconds: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

const REFRESH_LOCK_PREFIX = "oauth:refresh-lock:";
const REFRESH_LOCK_TTL_SECONDS = 120;

const inFlightRefreshByCredentialId = new Map<string, Promise<CredentialRefreshResult>>();

const ACQUIRE_RETRY_MS = 100;
const ACQUIRE_BUDGET_MS = 45_000;

const adoptPeerCredential = async (
  readFreshCredential: ReadFreshCredential | null,
): Promise<CredentialRefreshResult | null> => {
  const persisted = await readFreshCredential?.();
  if (!persisted) {
    return null;
  }
  widelog.set("token.refresh_adopted_peer", true);
  return persisted;
};

/* Resolves to the peer's credential, or to null once this caller holds the lock itself. */
const acquireOrAdopt = async (
  tryAcquire: () => Promise<boolean>,
  readFreshCredential: ReadFreshCredential | null,
  acquireBudgetMs: number,
): Promise<CredentialRefreshResult | null> => {
  const deadlineAt = Date.now() + acquireBudgetMs;
  for (;;) {
    if (Date.now() >= deadlineAt) {
      throw new Error("Token refresh already in progress on another instance");
    }
    if (await tryAcquire()) {
      return null;
    }
    const adopted = await adoptPeerCredential(readFreshCredential);
    if (adopted) {
      return adopted;
    }
    await Bun.sleep(ACQUIRE_RETRY_MS);
  }
};

const executeWithDistributedLock = async (
  lockStore: RefreshLockStore | null,
  lockKey: string,
  runRefresh: () => Promise<CredentialRefreshResult>,
  readFreshCredential: ReadFreshCredential | null,
  acquireBudgetMs: number,
): Promise<CredentialRefreshResult> => {
  if (!lockStore) {
    return runRefresh();
  }

  const tryAcquire = (): Promise<boolean> => lockStore
    .tryAcquire(lockKey, REFRESH_LOCK_TTL_SECONDS)
    .catch(() => false);

  const adoptedWhileWaiting = await acquireOrAdopt(tryAcquire, readFreshCredential, acquireBudgetMs);
  if (adoptedWhileWaiting) {
    return adoptedWhileWaiting;
  }

  try {
    const adopted = await adoptPeerCredential(readFreshCredential);
    if (adopted) {
      return adopted;
    }
    return await runRefresh();
  } finally {
    await lockStore.release(lockKey).catch(() => null);
  }
};

const runWithCredentialRefreshLock = (
  oauthCredentialId: string,
  runRefresh: () => Promise<CredentialRefreshResult>,
  lockStore: RefreshLockStore | null = null,
  readFreshCredential: ReadFreshCredential | null = null,
  acquireBudgetMs: number = ACQUIRE_BUDGET_MS,
): Promise<CredentialRefreshResult> => {
  const inFlight = inFlightRefreshByCredentialId.get(oauthCredentialId);
  if (inFlight) {
    /*
     * Only this branch runs in the joining caller's async context. The refresh body
     * below runs in whichever context first created the promise, so nothing may be
     * logged from inside it without landing on a foreign wide event.
     */
    widelog.set("token.refresh_coalesced", true);
    return inFlight;
  }

  const lockKey = `${REFRESH_LOCK_PREFIX}${oauthCredentialId}`;
  const refreshTask = executeWithDistributedLock(
    lockStore,
    lockKey,
    runRefresh,
    readFreshCredential,
    acquireBudgetMs,
  ).finally(() => {
    if (inFlightRefreshByCredentialId.get(oauthCredentialId) === refreshTask) {
      inFlightRefreshByCredentialId.delete(oauthCredentialId);
    }
  });

  inFlightRefreshByCredentialId.set(oauthCredentialId, refreshTask);

  return refreshTask;
};

export { ACQUIRE_BUDGET_MS, REFRESH_LOCK_TTL_SECONDS, runWithCredentialRefreshLock };
export type { CredentialRefreshResult, ReadFreshCredential, RefreshLockStore };
