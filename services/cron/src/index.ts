import { entry } from "entrykit";
import { join } from "node:path";
import { getAllJobs } from "./utils/get-jobs";
import { injectJobs } from "./utils/inject-jobs";
import { registerJobs } from "./utils/register-jobs";
import { closeDatabase } from "@keeper.sh/database";
import { RedisCommandOutboxStore } from "@keeper.sh/machine-orchestration";
import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import { context, destroy, widelog } from "./utils/logging";
import { recoverSourceIngestionOutbox } from "./recovery/source-ingestion-outbox-recovery";
import type { SourceIngestionLifecycleCommand } from "@keeper.sh/state-machines";

const jobsFolderPathname = join(import.meta.dirname, "jobs");
const RECOVERY_INTERVAL_MS = 10_000;

await entry({
  main: async () => {
    const { database, refreshLockRedis, shutdownRefreshLockRedis } = await import("./context");

    const jobs = await getAllJobs(jobsFolderPathname);
    const injectedJobs = injectJobs(jobs);
    registerJobs(injectedJobs);

    const sourceIngestionOutboxStore = new RedisCommandOutboxStore<SourceIngestionLifecycleCommand>({
      keyPrefix: "machine:outbox:source-ingestion-lifecycle",
      redis: refreshLockRedis,
    });

    const disableSource = async (calendarId: string): Promise<void> => {
      await database
        .update(calendarsTable)
        .set({ disabled: true })
        .where(eq(calendarsTable.id, calendarId));
    };

    const markNeedsReauth = async (calendarId: string): Promise<void> => {
      const [calendar] = await database
        .select({ accountId: calendarsTable.accountId })
        .from(calendarsTable)
        .where(eq(calendarsTable.id, calendarId))
        .limit(1);
      if (!calendar?.accountId) {
        return;
      }
      await database
        .update(calendarAccountsTable)
        .set({ needsReauthentication: true })
        .where(eq(calendarAccountsTable.id, calendar.accountId));
    };

    const persistSyncToken = async (calendarId: string, syncToken: string): Promise<void> => {
      await database
        .update(calendarsTable)
        .set({ syncToken })
        .where(eq(calendarsTable.id, calendarId));
    };

    const runSourceIngestionOutboxRecovery = (): Promise<void> =>
      context(async () => {
        widelog.set("operation.name", "source-ingestion-outbox-recovery");
        widelog.set("operation.type", "job");

        try {
          await widelog.time.measure("duration_ms", () =>
            recoverSourceIngestionOutbox({
              outboxStore: sourceIngestionOutboxStore,
              disableSource,
              markNeedsReauth,
              persistSyncToken,
            }),
          );
          widelog.set("outcome", "success");
        } catch (error) {
          widelog.set("outcome", "error");
          widelog.errorFields(error, { slug: "source-ingestion-outbox-recovery-failed" });
          throw error;
        } finally {
          widelog.flush();
        }
      });

    await runSourceIngestionOutboxRecovery();

    const recoveryInterval = setInterval(() => {
      runSourceIngestionOutboxRecovery().catch(() => globalThis.undefined);
    }, RECOVERY_INTERVAL_MS);

    return () => {
      clearInterval(recoveryInterval);
      destroy();
      shutdownRefreshLockRedis();
      closeDatabase(database);
    };
  },
  name: "cron",
});
