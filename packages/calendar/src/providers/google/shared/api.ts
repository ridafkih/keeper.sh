const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3/";
const GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars";
const GOOGLE_CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const GOOGLE_CALENDAR_MAX_RESULTS = 250;
const GONE_STATUS = 410;
const GOOGLE_BATCH_API = "https://www.googleapis.com/batch/calendar/v3";
const GOOGLE_BATCH_MAX_SIZE = 50;
/*
 * Google only reads conferenceData from a client that declares it understands the
 * field, and only then honours its absence as a removal. Every write carries it,
 * conference or not, so the two cases stay one code path.
 */
const GOOGLE_CONFERENCE_DATA_VERSION = "1";

export {
  GOOGLE_BATCH_API,
  GOOGLE_BATCH_MAX_SIZE,
  GOOGLE_CONFERENCE_DATA_VERSION,
  GOOGLE_CALENDAR_API,
  GOOGLE_CALENDAR_EVENTS_URL,
  GOOGLE_CALENDAR_LIST_URL,
  GOOGLE_CALENDAR_MAX_RESULTS,
  GONE_STATUS,
};
