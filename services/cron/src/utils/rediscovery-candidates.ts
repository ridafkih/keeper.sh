import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

const buildImportedCalendarExists = (): SQL<boolean> =>
  sql<boolean>`exists (
    select 1
    from ${calendarsTable}
    where ${calendarsTable.accountId} = ${calendarAccountsTable.id}
      and ${calendarsTable.originalName} is not null
      and (
        ${calendarsTable.externalCalendarId} is not null
        or ${calendarsTable.calendarUrl} is not null
      )
  )`;

export { buildImportedCalendarExists };
