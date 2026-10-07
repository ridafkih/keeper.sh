import type { CalendarKey, WritableCalendar } from "@keeper.sh/sync-protocol";

const referenceCalendar: CalendarKey = {
  provider: "reference",
  account: { kind: "accountId", value: "reference-account" },
  calendar: { kind: "calendarId", value: "reference-calendar" },
};

const referenceWritableCalendar: WritableCalendar = {
  key: referenceCalendar,
  access: "readWrite",
};

export { referenceCalendar, referenceWritableCalendar };
