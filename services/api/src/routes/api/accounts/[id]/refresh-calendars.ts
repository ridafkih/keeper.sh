import { handleRefreshCalendarsRoute } from "./refresh-calendars-route";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { redis, refreshLockStore } from "@/context";
import { checkAndClaimCalendarRefresh } from "@/utils/sync-trigger-limit";
import {
  createDefaultAccountCalendarRefreshDependencies,
  runAccountCalendarRefresh,
} from "@/utils/calendar-rediscovery";
import { loadRefreshableAccount } from "@/utils/account-calendar-discovery";

const CALENDAR_REDISCOVER_LOCK_TTL_SECONDS = 120;

const buildRefreshLockKey = (accountId: string): string =>
  `calendar-rediscover:${accountId}`;

const POST = withWideEvent(
  withAuth(({ params, userId }) =>
    handleRefreshCalendarsRoute({ params, userId }, {
      acquireRefreshLock: async (accountId) => {
        const key = buildRefreshLockKey(accountId);
        const acquired = await refreshLockStore.tryAcquire(
          key,
          CALENDAR_REDISCOVER_LOCK_TTL_SECONDS,
        );

        if (!acquired) {
          return { acquired: false };
        }

        return {
          acquired: true,
          handle: { release: () => refreshLockStore.release(key) },
        };
      },
      claimRefreshCooldown: (accountId) => checkAndClaimCalendarRefresh(redis, accountId),
      loadAccount: loadRefreshableAccount,
      refreshCalendars: async (options) =>
        runAccountCalendarRefresh(
          options,
          await createDefaultAccountCalendarRefreshDependencies(),
        ),
    })),
);

export { POST };
