import { calendarsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { RECONNECTED_CALENDAR_STATE } from "@/utils/calendar-state";
import type { KeeperCalendarPauseResult, KeeperDatabase } from "@/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isCalendarId = (value: string | undefined): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

const buildPauseState = (paused: boolean) => {
  if (paused) {
    return { disabled: true };
  }

  return RECONNECTED_CALENDAR_STATE;
};

const setCalendarPaused = async (
  database: KeeperDatabase,
  userId: string,
  calendarId: string,
  paused: boolean,
): Promise<KeeperCalendarPauseResult | null> => {
  const [updated] = await database
    .update(calendarsTable)
    .set(buildPauseState(paused))
    .where(and(eq(calendarsTable.id, calendarId), eq(calendarsTable.userId, userId)))
    .returning({ disabled: calendarsTable.disabled, id: calendarsTable.id });

  if (!updated) {
    return null;
  }

  return { calendarId: updated.id, paused: updated.disabled };
};

export { isCalendarId, setCalendarPaused };
