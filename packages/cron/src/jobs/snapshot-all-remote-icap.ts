import type { CronOptions } from "cronbake";
import { database } from "@keeper.sh/database";
import {
  remoteICalSourcesTable,
  calendarSnapshotsTable,
} from "@keeper.sh/database/schema";
import { pullRemoteCalendar } from "@keeper.sh/pull-calendar";
import { log } from "@keeper.sh/log";

type PullAndLogRemoteCalendarOptions = {
  url: string;
  userId: string;
};

const pullAndLogRemoteCalendar = async (
  id: string,
  { url, userId }: PullAndLogRemoteCalendarOptions,
) => {
  log.info({ id }, "fetching remote calendar");

  try {
    const result = await pullRemoteCalendar("icap", url);
    log.info({ id }, "fetched remote calendar");
    return { result, userId };
  } catch (error) {
    log.error({ error }, `could not fetch remote calendar '${id}'`);
    throw error;
  }
};

export const insertSnapshot = async (
  payload: typeof calendarSnapshotsTable.$inferInsert,
) => {
  try {
    database.insert(calendarSnapshotsTable).values(payload);
  } catch (error) {
    log.error({ error }, "failed to submit entry into the database");
  }
};

export default {
  name: import.meta.file,
  cron: "@every_5_minutes",
  callback: async () => {
    const remoteSources = await database.select().from(remoteICalSourcesTable);

    const fetches = remoteSources.map(({ id, url, userId }) => {
      return pullAndLogRemoteCalendar(id, { url, userId });
    });

    const settlements = await Promise.allSettled(fetches);

    for (const settlement of settlements) {
      if (settlement.status === "rejected") continue;

      const { value } = settlement;
      insertSnapshot({ userId: value.userId, ical: value.result });
    }
  },
} satisfies CronOptions;
