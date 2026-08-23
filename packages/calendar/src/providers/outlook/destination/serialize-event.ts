import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import type { OutlookEvent } from "@keeper.sh/data-schemas";
import type { MaterializedSyncableEvent } from "../../../core/types";
import type { OutlookDateTime } from "../types";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import {
  instantToWallTime,
  resolveTimeZone,
  wallTimeToInstant,
} from "../../../ics/utils/timezone-instant";
import { buildOutlookRecurrence } from "./serialize-recurrence";

const UTC_TIME_ZONE = "UTC";

const toGraphWallValue = (value: Date): string => value.toISOString().replace("Z", "");

// UTC is the only unambiguous label: a repeated fall-back wall time names two instants, and an all-day value is already snapped to the UTC day grid.
const buildOutlookDateTime = (
  value: Date,
  timeZone: string,
  isAllDay: boolean,
): OutlookDateTime => {
  if (isAllDay) {
    return { dateTime: toGraphWallValue(value), timeZone: UTC_TIME_ZONE };
  }

  const resolvedTimeZone = resolveTimeZone(timeZone);
  if (!resolvedTimeZone) {
    throw new RangeError("Outlook event timezone is required");
  }

  const wallTime = instantToWallTime(value, resolvedTimeZone);
  if (wallTimeToInstant(wallTime, resolvedTimeZone).getTime() !== value.getTime()) {
    return { dateTime: toGraphWallValue(value), timeZone: UTC_TIME_ZONE };
  }

  return { dateTime: toGraphWallValue(wallTime), timeZone };
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
  const recurrence = buildOutlookRecurrence(event);

  return {
    ...(body && { body }),
    ...(location && { location }),
    ...(event.isPrivate && { sensitivity: "private" }),
    ...(recurrence && { recurrence }),
    categories: [KEEPER_CATEGORY],
    end: buildOutlookDateTime(event.endTime, eventTimeZone, isAllDay),
    isAllDay,
    showAs: getShowAs(event.availability),
    start: buildOutlookDateTime(event.startTime, eventTimeZone, isAllDay),
    subject: event.summary,
  };
};

export { serializeOutlookEvent };
