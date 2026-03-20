import type { OutlookDateTime, PartialOutlookDateTime } from "../types";

const parseEventDateTime = (eventTime: OutlookDateTime): Date =>
  new Date(`${eventTime.dateTime}Z`);

const parseEventTime = (time: PartialOutlookDateTime | undefined): Date | null => {
  if (!time?.dateTime) {
    return null;
  }

  return new Date(`${time.dateTime}Z`);
};

export { parseEventDateTime, parseEventTime };
