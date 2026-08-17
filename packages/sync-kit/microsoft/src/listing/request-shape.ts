import type { ListingScope, TimeWindow } from "@keeper.sh/sync-protocol";
import type { ListingMode } from "../cursor/fingerprint";
import { expandKeeperProperties } from "../decode/extended-property";

const calendarViewSelect = [
  "id",
  "iCalUId",
  "subject",
  "body",
  "bodyPreview",
  "location",
  "start",
  "end",
  "isAllDay",
  "isCancelled",
  "showAs",
  "sensitivity",
  "type",
  "seriesMasterId",
  "originalStartTimeZone",
  "originalEndTimeZone",
  "recurrence",
  "onlineMeeting",
  "categories",
  "lastModifiedDateTime",
  "createdDateTime",
  "changeKey",
] as const;

const instancesSelect = calendarViewSelect;

const requestPaths = {
  calendarView: "calendarView",
  delta: "calendarView/delta",
  instances: "instances",
} as const;

type RequestPath = (typeof requestPaths)[keyof typeof requestPaths];

const selectedFields = (): string => instancesSelect.join(",");

const spanParameters = (bounds: TimeWindow): Readonly<Record<string, string>> => ({
  startDateTime: bounds.start.value,
  endDateTime: bounds.end.value,
});

/*
  Graph returns singleValueExtendedProperties only for a request that $expands them, and documents
  $expand as unsupported alongside the advanced query parameters $select rides with, so a request
  asks for one or the other, never both. Delta additionally rejects $expand outright.
  https://learn.microsoft.com/en-us/graph/api/singlevaluelegacyextendedproperty-get
  https://learn.microsoft.com/en-us/graph/known-issues
*/
const requestParameters = (
  scope: ListingScope,
  mode: ListingMode,
): Readonly<Record<string, string>> => {
  if (mode === "delta") {
    return { $select: selectedFields() };
  }
  const { window: bounds } = scope;
  return { ...spanParameters(bounds), $expand: expandKeeperProperties() };
};

const instancesParameters = (scope: ListingScope): Readonly<Record<string, string>> => {
  const { window: bounds } = scope;
  return { ...spanParameters(bounds), $expand: expandKeeperProperties() };
};

export {
  calendarViewSelect,
  instancesParameters,
  instancesSelect,
  requestParameters,
  requestPaths,
};
export type { RequestPath };
