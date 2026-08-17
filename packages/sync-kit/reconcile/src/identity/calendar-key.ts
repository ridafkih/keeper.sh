import type { CalendarKey } from "@keeper.sh/sync-protocol";
import { joinOnNul } from "./nul";

const calendarKeyString = (key: CalendarKey): string =>
  joinOnNul([key.provider, key.account.value, key.calendar.value]);

export { calendarKeyString };
