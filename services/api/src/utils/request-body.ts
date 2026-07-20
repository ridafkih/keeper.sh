import { type } from "arktype";
import { syncRangeSchema } from "@keeper.sh/data-schemas";

const calendarIdsBodySchema = type({
  calendarIds: "string[]",
  "+": "reject",
});
type CalendarIdsBody = typeof calendarIdsBodySchema.infer;

const sourcePatchBodySchema = type({
  "name?": "string",
  "customEventName?": "string",
  "excludeAllDayEvents?": "boolean",
  "excludeEventDescription?": "boolean",
  "excludeEventLocation?": "boolean",
  "excludeEventName?": "boolean",
  "excludeFocusTime?": "boolean",
  "excludeOutOfOffice?": "boolean",
  "includeInIcalFeed?": "boolean",
  "treatFullDayTimedEventsAsAllDay?": "boolean",
  "syncHistoricRange?": syncRangeSchema,
  "syncFutureRange?": syncRangeSchema,
  "+": "reject",
});
type SourcePatchBody = typeof sourcePatchBodySchema.infer;

const icalSettingsPatchBodySchema = type({
  "includeEventName?": "boolean",
  "includeEventDescription?": "boolean",
  "includeEventLocation?": "boolean",
  "excludeAllDayEvents?": "boolean",
  "customEventName?": "string",
  "+": "reject",
});
type IcalSettingsPatchBody = typeof icalSettingsPatchBodySchema.infer;

const eventCreateBodySchema = type({
  calendarId: "string",
  title: "string",
  "description?": "string",
  "location?": "string",
  startTime: "string",
  endTime: "string",
  "isAllDay?": "boolean",
  "availability?": "'busy' | 'free'",
  "timezone?": "string",
  "+": "reject",
});
type EventCreateBody = typeof eventCreateBodySchema.infer;

const eventPatchBodySchema = type({
  "title?": "string",
  "description?": "string",
  "location?": "string",
  "startTime?": "string",
  "endTime?": "string",
  "isAllDay?": "boolean",
  "availability?": "'busy' | 'free'",
  "timezone?": "string",
  "rsvpStatus?": "'accepted' | 'declined' | 'tentative'",
  "+": "reject",
});
type EventPatchBody = typeof eventPatchBodySchema.infer;

const tokenCreateBodySchema = type({
  name: "string",
  "+": "reject",
});
type TokenCreateBody = typeof tokenCreateBodySchema.infer;

export {
  calendarIdsBodySchema,
  sourcePatchBodySchema,
  icalSettingsPatchBodySchema,
  eventCreateBodySchema,
  eventPatchBodySchema,
  tokenCreateBodySchema,
};
export type {
  CalendarIdsBody,
  SourcePatchBody,
  IcalSettingsPatchBody,
  EventCreateBody,
  EventPatchBody,
  TokenCreateBody,
};
