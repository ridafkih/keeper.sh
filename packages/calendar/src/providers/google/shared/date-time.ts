import type { PartialGoogleDateTime } from "../types";

const parseEventDateTime = (eventTime: PartialGoogleDateTime): Date => {
  if (eventTime.dateTime) {
    return new Date(eventTime.dateTime);
  }
  if (eventTime.date) {
    return new Date(eventTime.date);
  }
  throw new Error("Event has no date or dateTime");
};

const parseEventTime = (time: PartialGoogleDateTime | undefined): Date | null => {
  if (time?.dateTime) {
    return new Date(time.dateTime);
  }
  if (time?.date) {
    return new Date(time.date);
  }
  return null;
};

export { parseEventDateTime, parseEventTime };
