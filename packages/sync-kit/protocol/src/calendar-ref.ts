import type { Continuation } from "./change-listing";
import type { AccountId, CalendarId, ProviderId, ZoneId } from "./handles";

const calendarAccessKinds = ["readOnly", "readWrite"] as const;
type CalendarAccess = (typeof calendarAccessKinds)[number];

interface CalendarKey {
  readonly provider: ProviderId;
  readonly account: AccountId;
  readonly calendar: CalendarId;
}

interface CalendarRef {
  readonly key: CalendarKey;
  readonly displayName: string;
  readonly timeZone: ZoneId | null;
  readonly access: CalendarAccess;
}

interface WritableCalendar {
  readonly key: CalendarKey;
  readonly access: Extract<CalendarAccess, "readWrite">;
}

type CalendarEnumeration =
  | {
      readonly kind: "snapshot";
      readonly account: AccountId;
      readonly calendars: readonly CalendarRef[];
      readonly continuation?: never;
    }
  | {
      readonly kind: "partial";
      readonly account: AccountId;
      readonly calendars: readonly CalendarRef[];
      readonly continuation: Continuation;
    };

export { calendarAccessKinds };
export type {
  CalendarAccess,
  CalendarEnumeration,
  CalendarKey,
  CalendarRef,
  WritableCalendar,
};
