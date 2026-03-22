import type { CronOptions } from "cronbake";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { ingestCalDAVSources } from "../lib/source-ingestion-caldav-runner";
import { ingestIcsSources } from "../lib/source-ingestion-ics-runner";
import { ingestOAuthSources } from "../lib/source-ingestion-oauth-runner";

const runAllSourceIngestionJobs = async (): Promise<void> => {
  await Promise.allSettled([
    ingestOAuthSources(),
    ingestCalDAVSources(),
    ingestIcsSources(),
  ]);
};

export default withCronWideEvent({
  async callback() {
    await runAllSourceIngestionJobs();
  },
  cron: "@every_1_minutes",
  immediate: true,
  name: "ingest-sources",
  overrunProtection: false,
}) satisfies CronOptions;
