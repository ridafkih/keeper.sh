import { calendarsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLClient } from "../database-client";
import { resolveCalendarCapabilities } from "./calendar-capabilities";

const setCalendarWriteAccess = async (
  database: Pick<BunSQLClient, "update">,
  calendarId: string,
  writable: boolean,
): Promise<void> => {
  await database
    .update(calendarsTable)
    .set({ capabilities: resolveCalendarCapabilities(writable) })
    .where(eq(calendarsTable.id, calendarId));
};

export { setCalendarWriteAccess };
