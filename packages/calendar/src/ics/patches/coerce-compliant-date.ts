import type { IcsPatch } from "../utils/apply-patches";

/**
 * Some providers (notably GameChanger's team-management iCal feeds) emit
 * all-day events as bare 8-digit date values:
 *
 *   DTSTART:20260515
 *   DTEND:20260518
 *
 * Per RFC 5545 §3.8.2.4, the default value type for `DTSTART`/`DTEND` is
 * `DATE-TIME`, which §3.3.5 defines strictly as `YYYYMMDDTHHMMSS` (the `T` is
 * mandatory). To denote a date-only value, the `VALUE=DATE` parameter is
 * required (§3.2.20 + §3.3.4). So `DTSTART:20260515` is neither a valid
 * `DATE-TIME` nor a properly-typed `DATE` — it is malformed.
 *
 * The fix only fires when the property has no parameters at all, so we never
 * overwrite an existing `TZID=...` or any other parameter the feed set.
 *
 * We also reject inputs whose digits don't form a real calendar date
 * (`20261301`, `20260230`, `00000000`, ...). Without this guard, ts-ics's
 * `new Date(Date.UTC(...))` would silently roll them over to plausible-looking
 * but wrong dates — turning a previously-dropped event into a phantom event on
 * the wrong day.
 */

const BARE_DATE_VALUE_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;

const isRealCalendarDate = (year: number, month: number, day: number): boolean => {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const utcMs = Date.UTC(year, month - 1, day);
  const reconstructed = new Date(utcMs);
  return (
    reconstructed.getUTCFullYear() === year &&
    reconstructed.getUTCMonth() === month - 1 &&
    reconstructed.getUTCDate() === day
  );
};

const coerceCompliantDate: IcsPatch = {
  coerce(params, value) {
    if (params.length > 0) {
      return null;
    }
    const match = BARE_DATE_VALUE_PATTERN.exec(value);
    if (!match) {
      return null;
    }
    const [, yearStr, monthStr, dayStr] = match;
    if (
      typeof yearStr !== "string" ||
      typeof monthStr !== "string" ||
      typeof dayStr !== "string"
    ) {
      return null;
    }
    if (!isRealCalendarDate(Number(yearStr), Number(monthStr), Number(dayStr))) {
      return null;
    }
    return { params: ";VALUE=DATE", value };
  },
  name: "coerce-compliant-date",
  properties: ["DTSTART", "DTEND", "EXDATE"],
};

export { coerceCompliantDate };
