import { fixtureManifestSchema } from "./schema";
import type { FixtureManifest } from "./schema";

const fixtureManifest: FixtureManifest = fixtureManifestSchema.assert([
  {
    description: "Google public US holidays feed with broad all-day event coverage",
    expected: {
      containsRecurrence: false,
      containsTimeZone: false,
    },
    fileName: "google-us-holidays.ics",
    id: "google-us-holidays",
    sourceUrl: "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics",
    tags: ["all_day", "holidays", "google"],
  },
  {
    description: "Google public Canada holidays feed for locale variation",
    expected: {
      containsRecurrence: false,
      containsTimeZone: false,
    },
    fileName: "google-canada-holidays.ics",
    id: "google-canada-holidays",
    sourceUrl: "https://calendar.google.com/calendar/ical/en.canadian%23holiday%40group.v.calendar.google.com/public/basic.ics",
    tags: ["all_day", "holidays", "google", "locale_variant"],
  },
  {
    description: "Official UK government bank holidays ICS (England and Wales)",
    expected: {
      containsRecurrence: false,
      containsTimeZone: false,
    },
    fileName: "govuk-bank-holidays-england-wales.ics",
    id: "govuk-bank-holidays-england-wales",
    sourceUrl: "https://www.gov.uk/bank-holidays/england-and-wales.ics",
    tags: ["all_day", "holidays", "government"],
  },
  {
    description: "CalendarLabs US holidays feed as alternate provider format",
    expected: {
      containsRecurrence: false,
      containsTimeZone: false,
    },
    fileName: "calendarlabs-us-holidays.ics",
    id: "calendarlabs-us-holidays",
    sourceUrl: "https://www.calendarlabs.com/ical-calendar/ics/76/US_Holidays.ics",
    tags: ["all_day", "holidays", "third_party"],
  },
  {
    description: "Hebcal geo-based feed with mixed all-day/timed events and TZID usage",
    expected: {
      containsRecurrence: false,
      containsTimeZone: true,
    },
    fileName: "hebcal-geoname-3448439.ics",
    id: "hebcal-geoname-3448439",
    sourceUrl: "https://www.hebcal.com/hebcal?v=1&cfg=ics&maj=on&min=on&mod=on&nx=on&year=now&month=x&ss=on&mf=on&c=on&geo=geoname&geonameid=3448439&M=on&s=on",
    tags: ["mixed", "religious", "tzid", "time_zone"],
  },
  {
    description: "UC Berkeley seminar feed with timed events and organizer/url fields",
    expected: {
      containsRecurrence: false,
      containsTimeZone: false,
    },
    fileName: "berkeley-ib-seminars.ics",
    id: "berkeley-ib-seminars",
    sourceUrl: "https://ib.berkeley.edu/seminars/ib_seminars.ics",
    tags: ["timed", "organizer", "url", "academic"],
  },
  {
    description: "Meetup NY Tech feed with VTIMEZONE and timezone RRULE blocks",
    expected: {
      containsRecurrence: true,
      containsTimeZone: true,
    },
    fileName: "meetup-ny-tech.ics",
    id: "meetup-ny-tech",
    sourceUrl: "https://www.meetup.com/ny-tech/events/ical/",
    tags: ["timed", "meetup", "vtimezone", "rrule"],
  },
  {
    description: "Meetup TorontoJS feed with VTIMEZONE and timezone RRULE blocks",
    expected: {
      containsRecurrence: true,
      containsTimeZone: true,
    },
    fileName: "meetup-torontojs.ics",
    id: "meetup-torontojs",
    sourceUrl: "https://www.meetup.com/TorontoJS/events/ical/",
    tags: ["timed", "meetup", "vtimezone", "rrule"],
  },
  {
    description: "Large Stanford featured-events feed for parser and memory stress testing",
    expected: {
      containsRecurrence: false,
      containsTimeZone: false,
    },
    fileName: "stanford-featured-events.ics",
    id: "stanford-featured-events",
    sourceUrl: "https://events.stanford.edu/calendar/featured-events.ics",
    tags: ["large_feed", "timed", "all_day", "stress_test"],
  },
  {
    description: "Microsoft Exchange/Outlook ICS export with Windows timezone IDs instead of IANA",
    expected: {
      containsRecurrence: true,
      containsTimeZone: true,
    },
    fileName: "outlook-exchange-windows-timezones.ics",
    id: "outlook-exchange-windows-timezones",
    tags: ["timed", "outlook", "windows_timezone", "rrule", "vtimezone"],
  },
]);

export { fixtureManifest };
