import { pluralize } from "./pluralize";

const IMPORTED_STATUS = "imported";
const ALREADY_CONNECTED_STATUS = "already_connected";

const readStatuses = (calendars: unknown): string[] => {
  if (!Array.isArray(calendars)) return [];
  return calendars.flatMap((calendar: unknown) => {
    if (typeof calendar !== "object" || calendar === null) return [];
    if (!("status" in calendar) || typeof calendar.status !== "string") return [];
    return [calendar.status];
  });
};

const countStatus = (statuses: string[], status: string): number =>
  statuses.filter((candidate) => candidate === status).length;

const resolveCalDAVImportNotice = (calendars: unknown): string | null => {
  const statuses = readStatuses(calendars);
  const alreadyConnected = countStatus(statuses, ALREADY_CONNECTED_STATUS);
  if (alreadyConnected === 0) return null;

  const imported = countStatus(statuses, IMPORTED_STATUS);
  if (imported === 0) return "Already connected";

  return `${pluralize(imported, "calendar")} added, ${alreadyConnected} already connected`;
};

export { resolveCalDAVImportNotice };
