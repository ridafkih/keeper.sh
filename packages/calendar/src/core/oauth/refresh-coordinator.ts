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

class OAuthRefreshInProgressError extends Error {
  readonly oauthRefreshInProgress = true;

  constructor(oauthCredentialId: string) {
    super(`Token refresh already in progress on another instance for credential ${oauthCredentialId}`);
    this.name = "OAuthRefreshInProgressError";
  }
}

class OAuthRefreshLockUnavailableError extends Error {
  readonly oauthRefreshLockUnavailable = true;

  constructor(oauthCredentialId: string, options: { cause: unknown }) {
    super(
      `Token refresh lock store is unreachable for credential ${oauthCredentialId}`,
      options,
    );
    this.name = "OAuthRefreshLockUnavailableError";
  }
}

const inFlightRefreshByCredentialId = new Map<string, Promise<CredentialRefreshResult>>();

const executeWithDistributedLock = async (
  lockStore: RefreshLockStore | null,
  oauthCredentialId: string,
  runRefresh: () => Promise<CredentialRefreshResult>,
): Promise<CredentialRefreshResult> => {
  if (!lockStore) {
    return runRefresh();
  }

  const lockKey = `${REFRESH_LOCK_PREFIX}${oauthCredentialId}`;
  const acquired = await lockStore
    .tryAcquire(lockKey, REFRESH_LOCK_TTL_SECONDS)
    .catch((error: unknown) => {
      throw new OAuthRefreshLockUnavailableError(oauthCredentialId, { cause: error });
    });

  if (!acquired) {
    throw new OAuthRefreshInProgressError(oauthCredentialId);
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

  const refreshTask = executeWithDistributedLock(
    lockStore,
    oauthCredentialId,
    runRefresh,
  ).finally(() => {
    if (inFlightRefreshByCredentialId.get(oauthCredentialId) === refreshTask) {
      inFlightRefreshByCredentialId.delete(oauthCredentialId);
    }
  });

  inFlightRefreshByCredentialId.set(oauthCredentialId, refreshTask);

  return refreshTask;
};

export {
  OAuthRefreshInProgressError,
  OAuthRefreshLockUnavailableError,
  runWithCredentialRefreshLock,
};
export type { CredentialRefreshResult, RefreshLockStore };
