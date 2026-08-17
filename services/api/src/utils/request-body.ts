import { type } from "arktype";
import { syncRangeSchema } from "@keeper.sh/data-schemas";

const calendarIdsBodySchema = type({
  calendarIds: "string[]",
  "+": "reject",
});
type CalendarIdsBody = typeof calendarIdsBodySchema.infer;

const writeBackModeBodySchema = type({
  writeBackMode: "'edits' | 'edits_and_deletes' | 'off'",
  "+": "reject",
});
type WriteBackModeBody = typeof writeBackModeBodySchema.infer;

/*
 * One level rather than a grant and a withdrawal, because the levels are ordered: moving
 * between any two of them is the same request, and a narrowing cannot be lost while a
 * widening survives.
 */
const writeBackReachBodySchema = type({
  writeBackReach: "'own_events' | 'my_meetings' | 'my_meetings_notifying' | 'any_event'",
  "+": "reject",
});
type WriteBackReachBody = typeof writeBackReachBodySchema.infer;

const deleteConfirmationBodySchema = type({
  decision: "'apply' | 'apply_empty_destination' | 'decline'",
  "+": "reject",
});
type DeleteConfirmationBody = typeof deleteConfirmationBodySchema.infer;

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

const icalFeedCreateBodySchema = type({
  name: "string",
  "+": "reject",
});
type IcalFeedCreateBody = typeof icalFeedCreateBodySchema.infer;

const icalFeedPatchBodySchema = type({
  "name?": "string",
  "includeEventName?": "boolean",
  "includeEventDescription?": "boolean",
  "includeEventLocation?": "boolean",
  "excludeAllDayEvents?": "boolean",
  "excludeFocusTime?": "boolean",
  "excludeOutOfOffice?": "boolean",
  "customEventName?": "string",
  "+": "reject",
});
type IcalFeedPatchBody = typeof icalFeedPatchBodySchema.infer;

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

const calendarPausePatchBodySchema = type({
  paused: "boolean",
  "+": "reject",
});
type CalendarPausePatchBody = typeof calendarPausePatchBodySchema.infer;

const tokenCreateBodySchema = type({
  name: "string",
  "+": "reject",
});
type TokenCreateBody = typeof tokenCreateBodySchema.infer;

export {
  calendarIdsBodySchema,
  deleteConfirmationBodySchema,
  writeBackReachBodySchema,
  writeBackModeBodySchema,
  calendarPausePatchBodySchema,
  sourcePatchBodySchema,
  icalSettingsPatchBodySchema,
  icalFeedCreateBodySchema,
  icalFeedPatchBodySchema,
  eventCreateBodySchema,
  eventPatchBodySchema,
  tokenCreateBodySchema,
};
export type {
  CalendarIdsBody,
  DeleteConfirmationBody,
  WriteBackReachBody,
  WriteBackModeBody,
  CalendarPausePatchBody,
  SourcePatchBody,
  IcalSettingsPatchBody,
  IcalFeedCreateBody,
  IcalFeedPatchBody,
  EventCreateBody,
  EventPatchBody,
  TokenCreateBody,
};
