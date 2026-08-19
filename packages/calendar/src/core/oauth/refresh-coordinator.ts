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
const REFRESH_LOCK_TTL_SECONDS = 30;

const inFlightRefreshByCredentialId = new Map<string, Promise<CredentialRefreshResult>>();

const ACQUIRE_RETRY_MS = 100;
const ACQUIRE_BUDGET_MS = REFRESH_LOCK_TTL_SECONDS * 1000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

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

const executeWithDistributedLock = async (
  lockStore: RefreshLockStore | null,
  lockKey: string,
  runRefresh: () => Promise<CredentialRefreshResult>,
  readFreshCredential: ReadFreshCredential | null,
): Promise<CredentialRefreshResult> => {
  if (!lockStore) {
    return runRefresh();
  }

  const tryAcquire = (): Promise<boolean> => lockStore
    .tryAcquire(lockKey, REFRESH_LOCK_TTL_SECONDS)
    .catch(() => false);

  let holdsLock = await tryAcquire();
  const deadlineAt = Date.now() + ACQUIRE_BUDGET_MS;
  while (!holdsLock) {
    const adopted = await adoptPeerCredential(readFreshCredential);
    if (adopted) {
      return adopted;
    }
    if (Date.now() >= deadlineAt) {
      throw new Error("Token refresh already in progress on another instance");
    }
    await sleep(ACQUIRE_RETRY_MS);
    holdsLock = await tryAcquire();
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
  ).finally(() => {
    if (inFlightRefreshByCredentialId.get(oauthCredentialId) === refreshTask) {
      inFlightRefreshByCredentialId.delete(oauthCredentialId);
    }
  });

  inFlightRefreshByCredentialId.set(oauthCredentialId, refreshTask);

  return refreshTask;
};

export { runWithCredentialRefreshLock };
export type { CredentialRefreshResult, ReadFreshCredential, RefreshLockStore };
