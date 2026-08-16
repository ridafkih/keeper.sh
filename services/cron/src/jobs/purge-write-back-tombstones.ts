import type { CronOptions } from "cronbake";
import { eventWriteBackTombstonesTable } from "@keeper.sh/database/schema";
import { lt } from "drizzle-orm";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";

/*
 * Both places the product asks a user to authorize destroying real events promise a record
 * of what was deleted "for 30 days". A record nothing ever removes is not a 30-day record:
 * the title, description and location of every source event Keeper destroyed would sit in
 * the snapshot indefinitely. This is the half of that promise that expires it.
 */
interface PurgeWriteBackTombstonesDependencies {
  deleteExpiredTombstones: (now: Date) => Promise<number>;
  now?: () => Date;
}

const runPurgeWriteBackTombstonesJob = async (
  dependencies: PurgeWriteBackTombstonesDependencies,
): Promise<void> => {
  const readNow = dependencies.now ?? (() => new Date());
  const purged = await dependencies.deleteExpiredTombstones(readNow());

  widelog.set("tombstones.purged_count", purged);
};

const createDefaultDependencies = async (): Promise<PurgeWriteBackTombstonesDependencies> => {
  const { database } = await import("@/context");

  return {
    deleteExpiredTombstones: async (now) => {
      const purged = await database
        .delete(eventWriteBackTombstonesTable)
        .where(lt(eventWriteBackTombstonesTable.expiresAt, now))
        .returning({ id: eventWriteBackTombstonesTable.id });
      return purged.length;
    },
  };
};

export default withCronWideEvent({
  async callback() {
    const dependencies = await createDefaultDependencies();
    await runPurgeWriteBackTombstonesJob(dependencies);
  },
  cron: "0 30 * * * *",
  immediate: true,
  name: import.meta.file,
}) satisfies CronOptions;

export { runPurgeWriteBackTombstonesJob };
export type { PurgeWriteBackTombstonesDependencies };
