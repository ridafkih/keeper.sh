import type { IcsPatch } from "../utils/apply-patches";

/**
 * Some providers (notably GameChanger's team-management iCal feeds) emit
 * all-day events as bare 8-digit date values:
 *
 *   DTSTART:20260515
 *   DTEND:20260518
 *   EXDATE:20260515,20260522
 *
 * Per RFC 5545 §3.8.2.4, the default value type for `DTSTART`/`DTEND` is
 * `DATE-TIME`, which §3.3.5 defines strictly as `YYYYMMDDTHHMMSS` (the `T` is
 * mandatory). To denote a date-only value, the `VALUE=DATE` parameter is
 * required (§3.2.20 + §3.3.4). `EXDATE` (§3.8.5.1) additionally permits a
 * comma-separated list of values, all of the same type. So `DTSTART:20260515`
 * is neither a valid `DATE-TIME` nor a properly-typed `DATE` — it is malformed.
 *
 * The fix only fires when the property has no parameters at all, so we never
 * overwrite an existing `TZID=...` or any other parameter the feed set, and
 * only when every comma-separated token is itself a real calendar date — a
 * mixed list (some bare dates, some date-times) is not a coherent target for
 * `VALUE=DATE`, so we leave such lines alone.
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

const isBareCalendarDateToken = (token: string): boolean => {
  const match = BARE_DATE_VALUE_PATTERN.exec(token);
  if (!match) {
    return false;
  }
  const [, yearStr, monthStr, dayStr] = match;
  if (
    typeof yearStr !== "string" ||
    typeof monthStr !== "string" ||
    typeof dayStr !== "string"
  ) {
    return false;
  }
  return isRealCalendarDate(Number(yearStr), Number(monthStr), Number(dayStr));
};

const coerceCompliantDate: IcsPatch = {
  coerce(params, value) {
    if (params.length > 0) {
      return null;
    }
    if (value.length === 0) {
      return null;
    }
    const tokens = value.split(",");
    for (const token of tokens) {
      if (!isBareCalendarDateToken(token)) {
        return null;
      }
    }
    return { params: ";VALUE=DATE", value };
  },
  properties: ["DTSTART", "DTEND", "EXDATE"],
};

export { coerceCompliantDate };
