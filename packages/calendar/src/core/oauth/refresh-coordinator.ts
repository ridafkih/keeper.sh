interface CredentialRefreshResult {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

interface RefreshLockStore {
  tryAcquire(key: string, ttlSeconds: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

const REFRESH_LOCK_PREFIX = "oauth:refresh-lock:";
const REFRESH_LOCK_TTL_SECONDS = 30;

const inFlightRefreshByCredentialId = new Map<string, Promise<CredentialRefreshResult>>();

const executeWithDistributedLock = async (
  lockStore: RefreshLockStore | null,
  lockKey: string,
  runRefresh: () => Promise<CredentialRefreshResult>,
): Promise<CredentialRefreshResult> => {
  if (!lockStore) {
    return runRefresh();
  }

  const acquired = await lockStore
    .tryAcquire(lockKey, REFRESH_LOCK_TTL_SECONDS)
    .catch(() => false);

  if (!acquired) {
    throw new Error("Token refresh already in progress on another instance");
  }

  try {
    return await runRefresh();
  } finally {
    await lockStore.release(lockKey).catch(() => {
      // Lock release is best-effort; TTL ensures cleanup
    });
  }
};

const runWithCredentialRefreshLock = (
  oauthCredentialId: string,
  runRefresh: () => Promise<CredentialRefreshResult>,
  lockStore: RefreshLockStore | null = null,
): Promise<CredentialRefreshResult> => {
  const inFlight = inFlightRefreshByCredentialId.get(oauthCredentialId);
  if (inFlight) {
    return inFlight;
  }

  const lockKey = `${REFRESH_LOCK_PREFIX}${oauthCredentialId}`;
  const refreshTask = executeWithDistributedLock(lockStore, lockKey, runRefresh).finally(() => {
    if (inFlightRefreshByCredentialId.get(oauthCredentialId) === refreshTask) {
      inFlightRefreshByCredentialId.delete(oauthCredentialId);
    }
  });

  inFlightRefreshByCredentialId.set(oauthCredentialId, refreshTask);

  return refreshTask;
};

export { runWithCredentialRefreshLock };
export type { CredentialRefreshResult, RefreshLockStore };
