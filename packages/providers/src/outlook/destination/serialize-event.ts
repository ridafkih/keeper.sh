import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import type { OutlookEvent } from "@keeper.sh/data-schemas";
import type { SyncableEvent } from "../../core";
import { resolveIsAllDayEvent } from "../../core";

const formatOutlookDateTime = (value: Date, isAllDay: boolean): string => {
  const isoString = value.toISOString();

  if (!isAllDay) {
    return isoString;
  }

  return isoString.replace("Z", "");
};

const getOutlookBody = (event: SyncableEvent): OutlookEvent["body"] => {
  if (!event.description) {
    return null;
  }

  return {
    content: event.description,
    contentType: "text",
  };
};

const getOutlookLocation = (event: SyncableEvent): OutlookEvent["location"] => {
  if (!event.location) {
    return;
  }

  return {
    displayName: event.location,
  };
};

const getShowAs = (availability: SyncableEvent["availability"]): string => {
  if (availability === "free") {
    return "free";
  }

  if (availability === "oof") {
    return "oof";
  }

  if (availability === "workingElsewhere") {
    return "workingElsewhere";
  }

  return "busy";
};

const serializeOutlookEvent = (event: SyncableEvent): OutlookEvent => {
  const body = getOutlookBody(event);
  const isAllDay = resolveIsAllDayEvent(event);
  const location = getOutlookLocation(event);
  const eventTimeZone = event.startTimeZone ?? "UTC";

  return {
    ...(body && { body }),
    ...(location && { location }),
    categories: [KEEPER_CATEGORY],
    end: {
      dateTime: formatOutlookDateTime(event.endTime, isAllDay),
      timeZone: eventTimeZone,
    },
    isAllDay,
    showAs: getShowAs(event.availability),
    start: {
      dateTime: formatOutlookDateTime(event.startTime, isAllDay),
      timeZone: eventTimeZone,
    },
    subject: event.summary,
  };
};

export { serializeOutlookEvent };
