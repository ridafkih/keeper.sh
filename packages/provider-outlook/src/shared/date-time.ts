import type { OutlookDateTime, PartialOutlookDateTime } from "../types";

const parseEventDateTime = (eventTime: OutlookDateTime): Date => {
  if (eventTime.timeZone === "UTC" && !eventTime.dateTime.endsWith("Z")) {
    return new Date(`${eventTime.dateTime}Z`);
  }
  return new Date(eventTime.dateTime);
};

const parseEventTime = (time: PartialOutlookDateTime | undefined): Date | null => {
  if (!time?.dateTime) {
    return null;
  }

  if (time.timeZone === "UTC" && !time.dateTime.endsWith("Z")) {
    return new Date(`${time.dateTime}Z`);
  }

  return new Date(time.dateTime);
};

export { parseEventDateTime, parseEventTime };
