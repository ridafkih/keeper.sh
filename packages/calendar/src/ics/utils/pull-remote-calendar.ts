import { BYTES_PER_MEBIBYTE, ResponseTooLargeError } from "../../utils/bounded-response";
import { createSafeFetch } from "../../utils/safe-fetch";
import type { SafeFetchOptions } from "../../utils/safe-fetch";
import { coerceCompliantDate } from "../patches/coerce-compliant-date";
import { parseIcsCalendarLenient } from "./lenient-parser";
import { HTTP_STATUS } from "@keeper.sh/constants";

const normalizeCalendarUrl = (url: string): string => {
  if (url.startsWith("webcal://")) {
    return url.replace("webcal://", "https://");
  }

  return url;
};

type CalendarFetchFailureReason =
  | "auth_required"
  | "http_error"
  | "not_found"
  | "not_ical"
  | "partial_response"
  | "too_large"
  | "truncated";

interface CalendarFetchErrorDetails {
  cause?: unknown;
  reason: CalendarFetchFailureReason;
  statusCode?: number;
}

class CalendarFetchError extends Error {
  public readonly statusCode?: number;
  public readonly reason: CalendarFetchFailureReason;
  public readonly authRequired: boolean;

  constructor(message: string, details: CalendarFetchErrorDetails) {
    super(message, { cause: details.cause });
    this.name = "CalendarFetchError";
    this.reason = details.reason;
    this.statusCode = details.statusCode;
    this.authRequired = details.reason === "auth_required";
  }
}

interface ParsedUrl {
  url: string;
  headers: Record<string, string>;
}

const parseUrlWithCredentials = (url: string): ParsedUrl => {
  const parsed = new URL(url);
  const headers: Record<string, string> = {};

  if (parsed.username || parsed.password) {
    const credentials = `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`;
    headers["Authorization"] = `Basic ${Buffer.from(credentials).toString("base64")}`;
    parsed.username = "";
    parsed.password = "";
  }

  return { headers, url: parsed.toString() };
};

const ICS_USER_AGENT = "Keeper/1.0 (+https://www.keeper.sh)";

const HTTP_STATUS_PARTIAL_CONTENT = 206;

const MAX_ICS_FEED_MEBIBYTES = 25;
const MAX_ICS_FEED_BYTES = MAX_ICS_FEED_MEBIBYTES * BYTES_PER_MEBIBYTE;

const CALENDAR_END_PATTERN = /(?:^|[\r\n])END:VCALENDAR[ \t]*(?:[\r\n]|$)/i;

const assertCalendarBodyComplete = (ical: string): void => {
  if (!CALENDAR_END_PATTERN.test(ical)) {
    throw new CalendarFetchError(
      "Calendar feed is truncated: missing END:VCALENDAR terminator.",
      { reason: "truncated" },
    );
  }
};

const readFeedBody = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch (error) {
    if (error instanceof ResponseTooLargeError) {
      throw new CalendarFetchError(
        `Calendar feed is too large. Feeds up to ${MAX_ICS_FEED_MEBIBYTES} MB are supported.`,
        { cause: error, reason: "too_large" },
      );
    }
    throw error;
  }
};

const fetchRemoteText = async (url: string, options?: SafeFetchOptions): Promise<string> => {
  const { url: cleanUrl, headers } = parseUrlWithCredentials(url);
  const safeFetch = createSafeFetch({ maxResponseBytes: MAX_ICS_FEED_BYTES, ...options });
  const response = await safeFetch(cleanUrl, {
    headers: { "User-Agent": ICS_USER_AGENT, ...headers },
  });

  /* Response.ok covers 206 too, and a range fragment would diff as deletions. */
  if (response.status === HTTP_STATUS_PARTIAL_CONTENT) {
    throw new CalendarFetchError(
      "Calendar server returned a partial (206) response; refusing to treat a fragment as the whole feed.",
      { reason: "partial_response", statusCode: response.status },
    );
  }

  if (!response.ok) {
    if (response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN) {
      throw new CalendarFetchError(
        "Calendar requires authentication. Use a public URL or include credentials in the URL (https://user:pass@host/path).",
        { reason: "auth_required", statusCode: response.status },
      );
    }

    if (response.status === HTTP_STATUS.NOT_FOUND) {
      throw new CalendarFetchError(
        "Calendar not found. Check that the URL is correct.",
        { reason: "not_found", statusCode: response.status },
      );
    }

    throw new CalendarFetchError(
      `Failed to fetch calendar (HTTP ${response.status})`,
      { reason: "http_error", statusCode: response.status },
    );
  }

  return readFeedBody(response);
};

type ParsedCalendarResult = ReturnType<typeof parseIcsCalendarLenient>;

type OutputICal = "ical" | ["ical"];
type OutputJSON = "json" | ["json"];
type OutputICALOrJSON = ["ical", "json"] | ["json", "ical"];

interface JustICal {
  ical: string;
  json?: never;
}
interface JustJSON {
  json: ParsedCalendarResult;
  ical?: never;
}
type ICalOrJSON = Omit<JustICal, "json"> & Omit<JustJSON, "ical">;

const normalizeOutputToArray = (output: OutputJSON | OutputICal | OutputICALOrJSON): string[] => {
  if (typeof output === "string") {
    return [output];
  }
  return output;
};

async function pullRemoteCalendar(output: OutputICal, url: string, options?: SafeFetchOptions): Promise<JustICal>;

async function pullRemoteCalendar(output: OutputJSON, url: string, options?: SafeFetchOptions): Promise<JustJSON>;

async function pullRemoteCalendar(output: OutputICALOrJSON, url: string, options?: SafeFetchOptions): Promise<ICalOrJSON>;

async function pullRemoteCalendar(
  output: OutputJSON | OutputICal | OutputICALOrJSON,
  url: string,
  options?: SafeFetchOptions,
): Promise<JustICal | JustJSON | ICalOrJSON> {
  const outputs = normalizeOutputToArray(output);
  const normalizedUrl = normalizeCalendarUrl(url);
  const ical = await fetchRemoteText(normalizedUrl, options);
  assertCalendarBodyComplete(ical);
  const json = parseIcsCalendarLenient({ icsString: ical, patches: [coerceCompliantDate] });

  if (!json.version || !json.prodId) {
    throw new CalendarFetchError(
      "URL does not return a valid iCal file. Make sure the URL points directly to an .ics file.",
      { reason: "not_ical" },
    );
  }

  if (!outputs.includes("json")) {
    return { ical };
  }

  if (!outputs.includes("ical")) {
    return { json };
  }

  return { ical, json };
}

export { CalendarFetchError, MAX_ICS_FEED_BYTES, pullRemoteCalendar };
export type { CalendarFetchFailureReason };
