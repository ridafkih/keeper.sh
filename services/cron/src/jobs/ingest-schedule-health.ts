import type { CronOptions } from "cronbake";
import { readIngestScheduleHealth } from "@keeper.sh/database";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";

export default withCronWideEvent({
  async callback() {
    const { database } = await import("@/context");
    const health = await readIngestScheduleHealth(database);
    widelog.setFields({
      "schedule.credential_rejected_count": health.credentialRejectedCount,
      "schedule.due_backlog": health.dueBacklog,
      "schedule.ineligible_count": health.ineligibleCount,
      "schedule.leased_count": health.leasedCount,
      "schedule.oldest_due_lag_ms": health.oldestDueLagMs,
      "schedule.oldest_wake_lag_ms": health.oldestWakeLagMs,
      "schedule.scheduled_count": health.scheduledCount,
      "schedule.unresolvable_count": health.unresolvableCount,
      "schedule.wake_backlog": health.wakeBacklog,
    });
  },
  cron: "@every_1_minutes",
  name: "ingest-schedule-health",
  overrunProtection: true,
}) satisfies CronOptions;
