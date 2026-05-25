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
 */

const BARE_DATE_VALUE_PATTERN = /^\d{8}$/;

const coerceCompliantDate: IcsPatch = {
  coerce(params, value) {
    if (params.length > 0) {
      return null;
    }
    if (!BARE_DATE_VALUE_PATTERN.test(value)) {
      return null;
    }
    return { params: ";VALUE=DATE", value };
  },
  name: "coerce-compliant-date",
  properties: ["DTSTART", "DTEND", "EXDATE", "RDATE"],
  spec: "RFC 5545 §3.3.4 / §3.8.2.4 — DATE values require the VALUE=DATE parameter",
};

export { coerceCompliantDate };
