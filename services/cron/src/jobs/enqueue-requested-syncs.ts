import type { CronOptions } from "cronbake";
import { enqueueDestinationSyncsForUsers } from "@/utils/enqueue-destination-syncs";
import { withCronWideEvent } from "@/utils/with-wide-event";

export default withCronWideEvent({
  async callback() {
    await enqueueDestinationSyncsForUsers([]);
  },
  cron: "@every_1_minutes",
  name: "enqueue-requested-syncs",
  overrunProtection: true,
}) satisfies CronOptions;
