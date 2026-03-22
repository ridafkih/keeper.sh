import { database, redis } from "@/context";
import { invalidateCalendarsForAccount } from "@/utils/invalidate-calendars";
import { deleteCalendarDestinationWithDatabase } from "./destination-query-repository";

const deleteCalendarDestination = async (
  userId: string,
  accountId: string,
): Promise<boolean> => {
  await invalidateCalendarsForAccount(database, redis, accountId);
  return deleteCalendarDestinationWithDatabase(database, userId, accountId);
};

export {
  deleteCalendarDestination,
};
