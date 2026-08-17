import type { calendar_v3 } from "@googleapis/calendar";

const googleEventStatuses = ["confirmed", "tentative", "cancelled"] as const;
type GoogleEventStatus = (typeof googleEventStatuses)[number];

const isCancelledItem = (item: calendar_v3.Schema$Event): boolean => item.status === "cancelled";

export { googleEventStatuses, isCancelledItem };
export type { GoogleEventStatus };
