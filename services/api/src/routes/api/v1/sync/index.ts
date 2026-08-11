import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { checkAndClaimSyncTrigger } from "@/utils/sync-trigger-limit";
import { triggerSync } from "@/utils/trigger-sync";
import { widelog } from "@/utils/logging";
import { premiumService, redis } from "@/context";

const POST = withWideEvent(
  withV1Auth(async ({ userId }) => {
    const cooldown = await checkAndClaimSyncTrigger(redis, userId);

    if (!cooldown.allowed) {
      widelog.set("sync_trigger.throttled", true);
      widelog.set("sync_trigger.retry_after_seconds", cooldown.retryAfterSeconds);
      const throttled = ErrorResponse.tooManyRequests(
        `A sync was already requested recently. Try again in ${cooldown.retryAfterSeconds} seconds.`,
      ).toResponse();
      throttled.headers.set("Retry-After", String(cooldown.retryAfterSeconds));
      return throttled;
    }

    const plan = await premiumService.getUserPlan(userId);
    if (!plan) {
      throw new Error("Unable to resolve user plan for sync trigger");
    }

    const result = await triggerSync(userId, plan);
    widelog.set("sync_trigger.sources_refreshed", result.sourcesRefreshed);

    return Response.json(result);
  }),
);

export { POST };
