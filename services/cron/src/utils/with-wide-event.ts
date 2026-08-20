import type { CronOptions } from "cronbake";
import { resolveDatabaseErrorClassification } from "@keeper.sh/database";
import { context, widelog } from "./logging";

interface WideEventOptions {
  fields?: Record<string, unknown>;
  name: string;
  onError: (error: unknown) => void;
  run: () => Promise<void> | void;
}

/*
 * The flush lives here alone: a caller that sets fields without emitting them is invisible
 * in production, which is how the signalled drain lost its event.
 */
const withWideEvent = ({ fields, name, onError, run }: WideEventOptions): Promise<void> =>
  context(async () => {
    widelog.set("operation.name", name);
    widelog.set("operation.type", "job");
    if (fields) {
      widelog.setFields(fields);
    }

    try {
      await widelog.time.measure("duration_ms", run);
      widelog.set("outcome", "success");
    } catch (error) {
      widelog.set("outcome", "error");
      onError(error);
    } finally {
      widelog.flush();
    }
  });

const withCronWideEvent = (options: CronOptions): CronOptions => ({
  ...options,
  callback: async () => {
    await withWideEvent({
      name: options.name,
      onError: (error) => {
        const databaseError = resolveDatabaseErrorClassification(error);
        if (databaseError?.sqlState) {
          widelog.set("db.error_sqlstate", databaseError.sqlState);
        }
        widelog.errorFields(error, { slug: databaseError?.slug ?? "unclassified" });
        throw error;
      },
      run: options.callback,
    });
  },
});

export { withCronWideEvent, withWideEvent };
export type { WideEventOptions };
