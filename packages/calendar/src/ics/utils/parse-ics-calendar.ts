import { convertIcsCalendar } from "ts-ics";

interface ParseIcsCalendarOptions {
  icsString: string;
}

const parseIcsCalendar = (options: ParseIcsCalendarOptions) =>
  convertIcsCalendar(globalThis.undefined, options.icsString);

export { parseIcsCalendar };
