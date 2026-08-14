import { allSettledWithConcurrency } from "@keeper.sh/calendar";
import { handleRefreshCalendarsRoute } from "./refresh-calendars-route";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { redis, refreshLockStore } from "@/context";
import {
  CALENDAR_REFRESH_COOLDOWN_SECONDS,
  checkAndClaimCalendarRefresh,
} from "@/utils/sync-trigger-limit";
import {
  createDefaultAccountCalendarRefreshDependencies,
  runAccountCalendarRefresh,
} from "@/utils/calendar-rediscovery";
import { loadRefreshableAccountsForUser } from "@/utils/account-calendar-discovery";

const CALENDAR_REDISCOVER_LOCK_TTL_SECONDS = 120;
const REFRESH_CONCURRENCY = 3;

const buildRefreshLockKey = (accountId: string): string =>
  `calendar-rediscover:${accountId}`;

const POST = withWideEvent(
  withAuth(({ userId }) =>
    handleRefreshCalendarsRoute({ userId }, {
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
      claimRefreshCooldown: (id) => checkAndClaimCalendarRefresh(redis, id),
      cooldownSeconds: CALENDAR_REFRESH_COOLDOWN_SECONDS,
      loadAccounts: loadRefreshableAccountsForUser,
      refreshCalendars: async (options) =>
        runAccountCalendarRefresh(
          options,
          await createDefaultAccountCalendarRefreshDependencies(),
        ),
      runConcurrently: (tasks) =>
        allSettledWithConcurrency(tasks, { concurrency: REFRESH_CONCURRENCY }),
    })),
);

export { POST };
