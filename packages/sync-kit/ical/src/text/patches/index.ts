import type { IcsPatch } from "../patch";
import { coerceCompliantDate } from "./coerce-compliant-date";
import { splitMixedExdate } from "./split-mixed-exdate";

const defaultIcsPatches = [coerceCompliantDate, splitMixedExdate] as const satisfies readonly IcsPatch[];

export { defaultIcsPatches };
