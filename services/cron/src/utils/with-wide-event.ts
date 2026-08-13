import type { CronOptions } from "cronbake";
import { resolveDatabaseErrorClassification } from "@keeper.sh/database";
import { context, widelog } from "./logging";

const withCronWideEvent = (options: CronOptions): CronOptions => ({
  ...options,
  callback: async () => {
    await context(async () => {
      widelog.set("operation.name", options.name);
      widelog.set("operation.type", "job");

      try {
        await widelog.time.measure("duration_ms", options.callback);
        widelog.set("outcome", "success");
      } catch (error) {
        widelog.set("outcome", "error");
        const databaseError = resolveDatabaseErrorClassification(error);
        if (databaseError?.sqlState) {
          widelog.set("db.error_sqlstate", databaseError.sqlState);
        }
        widelog.errorFields(error, { slug: databaseError?.slug ?? "unclassified" });
        throw error;
      } finally {
        widelog.flush();
      }
    });
  },
});

export { withCronWideEvent };
