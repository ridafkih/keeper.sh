import type { IcsPatch, IcsPatchCoercion } from "@keeper.sh/sync-ical";
import { defaultIcsPatches } from "@keeper.sh/sync-ical";

const datedProperties = ["DTSTART", "DTEND", "EXDATE", "RDATE", "RECURRENCE-ID"] as const;

const extendedDateTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z?)$/u;

const coerceExtendedDateTime: IcsPatch = {
  properties: datedProperties,
  coerce: (params: string, value: string): IcsPatchCoercion | null => {
    const matched = extendedDateTime.exec(value.trim());
    if (!matched) {
      return null;
    }
    const [, year, month, day, hour, minute, second, zulu] = matched;
    return { params, value: `${year}${month}${day}T${hour}${minute}${second}${zulu ?? ""}` };
  },
};

const caldavIcsPatches: readonly IcsPatch[] = [...defaultIcsPatches, coerceExtendedDateTime];

export { caldavIcsPatches, coerceExtendedDateTime };
