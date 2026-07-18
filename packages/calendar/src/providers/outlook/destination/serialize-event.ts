import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import type { OutlookEvent } from "@keeper.sh/data-schemas";
import type { MaterializedSyncableEvent } from "../../../core/types";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import {
  instantToWallTime,
  resolveTimeZone,
} from "../../../ics/utils/timezone-instant";

const formatOutlookDateTime = (
  value: Date,
  timeZone: string,
  isAllDay: boolean,
): string => {
  if (isAllDay) {
    return value.toISOString().replace("Z", "");
  }
  const resolvedTimeZone = resolveTimeZone(timeZone);
  if (!resolvedTimeZone) {
    throw new RangeError("Outlook event timezone is required");
  }
  return instantToWallTime(value, resolvedTimeZone).toISOString().replace("Z", "");
};

const getOutlookBody = (event: MaterializedSyncableEvent): OutlookEvent["body"] => {
  if (!event.description) {
    return null;
  }

  return {
    content: event.description,
    contentType: "text",
  };
};

const getOutlookLocation = (event: MaterializedSyncableEvent): OutlookEvent["location"] => {
  if (!event.location) {
    return;
  }

  return {
    displayName: event.location,
  };
};

const getShowAs = (availability: MaterializedSyncableEvent["availability"]): string => {
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

const serializeOutlookEvent = (event: MaterializedSyncableEvent): OutlookEvent => {
  const body = getOutlookBody(event);
  const isAllDay = resolveIsAllDayEvent(event);
  const location = getOutlookLocation(event);
  const eventTimeZone = event.startTimeZone ?? "UTC";

  return {
    ...(body && { body }),
    ...(location && { location }),
    categories: [KEEPER_CATEGORY],
    end: {
      dateTime: formatOutlookDateTime(event.endTime, eventTimeZone, isAllDay),
      timeZone: eventTimeZone,
    },
    isAllDay,
    showAs: getShowAs(event.availability),
    start: {
      dateTime: formatOutlookDateTime(event.startTime, eventTimeZone, isAllDay),
      timeZone: eventTimeZone,
    },
    subject: event.summary,
  };
};

export { serializeOutlookEvent };
