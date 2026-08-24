import type { IcsCalendar } from "ts-ics";
import { parseIcsCalendar } from "./parse-ics-calendar";
import { applyIcsPatches } from "./apply-patches";
import type { IcsPatch } from "./apply-patches";

interface ParseIcsCalendarLenientOptions {
  icsString: string;
  patches: readonly IcsPatch[];
}

const parseIcsCalendarLenient = (options: ParseIcsCalendarLenientOptions): IcsCalendar =>
  parseIcsCalendar({ icsString: applyIcsPatches(options.icsString, options.patches) });

export { parseIcsCalendarLenient };
export type { ParseIcsCalendarLenientOptions };
