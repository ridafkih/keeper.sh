import { convertIcsCalendar } from "ts-ics";

interface ParseIcsCalendarOptions {
  icsString: string;
}

const parseIcsCalendar = (options: ParseIcsCalendarOptions) =>
  // eslint-disable-next-line no-undefined
  convertIcsCalendar(undefined, options.icsString);

export { parseIcsCalendar };
