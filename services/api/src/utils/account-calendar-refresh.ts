import { invalidateCalendarDiscoveryCache } from "@keeper.sh/calendar/caldav";
import { redis, refreshLockStore } from "@/context";
import {
  createDefaultAccountCalendarRefreshDependencies,
  runAccountCalendarRefresh,
} from "./calendar-rediscovery";
import type { AccountCalendarRefreshSummary } from "./calendar-rediscovery";

const CALENDAR_REDISCOVER_LOCK_TTL_SECONDS = 120;

interface RefreshLockHandle {
  release: () => Promise<void>;
}

type RefreshLockClaim =
  | { acquired: true; handle: RefreshLockHandle }
  | { acquired: false };

interface AccountCalendarRefreshTarget {
  accountId: string;
  userId: string;
}

const buildRefreshLockKey = (accountId: string): string =>
  `calendar-rediscover:${accountId}`;

const acquireAccountRefreshLock = async (accountId: string): Promise<RefreshLockClaim> => {
  const key = buildRefreshLockKey(accountId);
  const acquired = await refreshLockStore.tryAcquire(key, CALENDAR_REDISCOVER_LOCK_TTL_SECONDS);

  if (!acquired) {
    return { acquired: false };
  }

  return {
    acquired: true,
    handle: { release: () => refreshLockStore.release(key) },
  };
};

const refreshAccountCalendars = async (
  target: AccountCalendarRefreshTarget,
): Promise<AccountCalendarRefreshSummary> => {
  const summary = await runAccountCalendarRefresh(
    target,
    await createDefaultAccountCalendarRefreshDependencies(),
  );
  await invalidateCalendarDiscoveryCache(redis, target.accountId);
  return summary;
};

export { acquireAccountRefreshLock, refreshAccountCalendars };
export type { AccountCalendarRefreshTarget, RefreshLockClaim, RefreshLockHandle };
