import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import type { OutlookEvent } from "@keeper.sh/data-schemas";
import type { MaterializedSyncableEvent } from "../../../core/types";
import type { OutlookDateTime } from "../types";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import { buildOutlookRecurrence } from "./serialize-recurrence";

const UTC_TIME_ZONE = "UTC";

const toUtcOutlookDateTime = (value: Date): OutlookDateTime => ({
  dateTime: value.toISOString().replace("Z", ""),
  timeZone: UTC_TIME_ZONE,
});

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
  const recurrence = buildOutlookRecurrence(event);

  return {
    ...(body && { body }),
    ...(location && { location }),
    ...(event.isPrivate && { sensitivity: "private" }),
    ...(recurrence && { recurrence }),
    categories: [KEEPER_CATEGORY],
    end: toUtcOutlookDateTime(event.endTime),
    isAllDay,
    showAs: getShowAs(event.availability),
    start: toUtcOutlookDateTime(event.startTime),
    subject: event.summary,
  };
};

export { serializeOutlookEvent };
