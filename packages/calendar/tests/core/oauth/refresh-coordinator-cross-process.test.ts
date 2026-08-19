import { describe, expect, it } from "vitest";
import {
  ACQUIRE_BUDGET_MS,
  REFRESH_LOCK_TTL_SECONDS,
  runWithCredentialRefreshLock,
} from "../../../src/core/oauth/refresh-coordinator";
import { TOKEN_REFRESH_BUFFER_MS } from "@keeper.sh/constants";
import type { CredentialRefreshResult } from "../../../src/core/oauth/refresh-coordinator";

/*
 * The in-process coalescing map is per-replica, so a peer holding the redis lock is the
 * normal case once the worker scales. The loser must adopt what the winner persisted:
 * refreshing again rotates the refresh token out from under the winner.
 */

const CREDENTIAL_ID = "credential-shared";

const createLockStore = () => {
  const held = new Set<string>();
  return {
    held,
    release: (key: string): Promise<void> => {
      held.delete(key);
      return Promise.resolve();
    },
    tryAcquire: (key: string): Promise<boolean> => {
      if (held.has(key)) {
        return Promise.resolve(false);
      }
      held.add(key);
      return Promise.resolve(true);
    },
  };
};

/* Mirrors coordinated-refresher's rule: only a credential the caller will accept is adoptable. */
const adoptableOnlyWhenLongLived = (
  candidate: CredentialRefreshResult,
): CredentialRefreshResult | null => {
  if (candidate.expires_in * 1000 <= TOKEN_REFRESH_BUFFER_MS) {
    return null;
  }
  return candidate;
};

const freshCredential: CredentialRefreshResult = {
  access_token: "peer-persisted-token",
  expires_in: 3400,
};

describe("credential refresh across processes", () => {
  it("keeps the waiting budget below the lock ttl so a waiter never outlives the holder", () => {
    expect(ACQUIRE_BUDGET_MS).toBeLessThan(REFRESH_LOCK_TTL_SECONDS * 1000);
  });

  it("refreshes rather than adopting when the stored credential is what the caller wants replaced", async () => {
    const lockStore = createLockStore();
    let rawRefreshes = 0;
    const nearlyExpired: CredentialRefreshResult = {
      access_token: "caller-own-token",
      expires_in: 120,
    };

    const result = await runWithCredentialRefreshLock(
      CREDENTIAL_ID,
      () => {
        rawRefreshes += 1;
        return Promise.resolve({ access_token: "refreshed-token", expires_in: 3600 });
      },
      lockStore,
      () => Promise.resolve(adoptableOnlyWhenLongLived(nearlyExpired)),
    );

    expect(result.access_token).toBe("refreshed-token");
    expect(rawRefreshes).toBe(1);
  });

  it("adopts the peer's persisted credential instead of failing the job", async () => {
    const lockStore = createLockStore();
    lockStore.held.add("oauth:refresh-lock:credential-shared");
    let rawRefreshes = 0;

    const result = await runWithCredentialRefreshLock(
      CREDENTIAL_ID,
      () => {
        rawRefreshes += 1;
        return Promise.resolve({ access_token: "loser-token", expires_in: 3600 });
      },
      lockStore,
      () => Promise.resolve(freshCredential),
    );

    expect(result.access_token).toBe("peer-persisted-token");
    expect(rawRefreshes).toBe(0);
  });

  it("still refreshes when it wins the lock and nothing fresh is stored", async () => {
    const lockStore = createLockStore();
    let rawRefreshes = 0;

    const result = await runWithCredentialRefreshLock(
      CREDENTIAL_ID,
      () => {
        rawRefreshes += 1;
        return Promise.resolve({ access_token: "own-token", expires_in: 3600 });
      },
      lockStore,
      () => Promise.resolve(null),
    );

    expect(result.access_token).toBe("own-token");
    expect(rawRefreshes).toBe(1);
    expect(lockStore.held.size).toBe(0);
  });

  it("waits for a peer that releases mid-flight rather than throwing", async () => {
    const lockStore = createLockStore();
    const lockKey = "oauth:refresh-lock:credential-shared";
    lockStore.held.add(lockKey);
    setTimeout(() => lockStore.held.delete(lockKey), 150);

    let persisted: CredentialRefreshResult | null = null;
    const result = await runWithCredentialRefreshLock(
      CREDENTIAL_ID,
      () => Promise.resolve({ access_token: "own-token", expires_in: 3600 }),
      lockStore,
      () => Promise.resolve(persisted),
    );

    expect(result.access_token).toBe("own-token");
    persisted = freshCredential;
  });
});
