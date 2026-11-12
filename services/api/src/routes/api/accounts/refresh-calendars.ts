import { allSettledWithConcurrency } from "@keeper.sh/calendar";
import { handleRefreshCalendarsRoute } from "./refresh-calendars-route";
import { withAuth, withWideEvent } from "@/utils/middleware";
import type { AuthenticatedRouteCallback } from "@/utils/middleware";
import { redis } from "@/context";
import {
  CALENDAR_REFRESH_COOLDOWN_SECONDS,
  checkAndClaimCalendarRefresh,
} from "@/utils/sync-trigger-limit";
import {
  acquireAccountRefreshLock,
  refreshAccountCalendars,
} from "@/utils/account-calendar-refresh";
import { loadRefreshableAccountsForUser } from "@/utils/account-calendar-discovery";

const REFRESH_CONCURRENCY = 3;

const refreshAllAccountCalendars: AuthenticatedRouteCallback = ({ userId }) =>
  handleRefreshCalendarsRoute({ userId }, {
    acquireRefreshLock: acquireAccountRefreshLock,
    claimRefreshCooldown: (id) => checkAndClaimCalendarRefresh(redis, id),
    cooldownSeconds: CALENDAR_REFRESH_COOLDOWN_SECONDS,
    loadAccounts: loadRefreshableAccountsForUser,
    refreshCalendars: refreshAccountCalendars,
    runConcurrently: (tasks) =>
      allSettledWithConcurrency(tasks, { concurrency: REFRESH_CONCURRENCY }),
  });

const POST = withWideEvent(withAuth(refreshAllAccountCalendars));

export { POST, refreshAllAccountCalendars };
