import { createSafeFetch } from "../../utils/safe-fetch";
import type { SafeFetchOptions } from "../../utils/safe-fetch";
import { parseIcsCalendar } from "./parse-ics-calendar";
import { HTTP_STATUS } from "@keeper.sh/constants";

const normalizeCalendarUrl = (url: string): string => {
  if (url.startsWith("webcal://")) {
    return url.replace("webcal://", "https://");
  }

  return url;
};

class CalendarFetchError extends Error {
  public readonly statusCode?: number;
  public readonly authRequired: boolean;

  constructor(
    message: string,
    statusCode?: number,
  ) {
    super(message);
    this.name = "CalendarFetchError";
    this.statusCode = statusCode;
    this.authRequired =
      statusCode === HTTP_STATUS.UNAUTHORIZED || statusCode === HTTP_STATUS.FORBIDDEN;
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

const fetchRemoteText = async (url: string, options?: SafeFetchOptions): Promise<string> => {
  const { url: cleanUrl, headers } = parseUrlWithCredentials(url);
  const safeFetch = createSafeFetch(options);
  const response = await safeFetch(cleanUrl, { headers });

  if (!response.ok) {
    if (response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN) {
      throw new CalendarFetchError(
        "Calendar requires authentication. Use a public URL or include credentials in the URL (https://user:pass@host/path).",
        response.status,
      );
    }

    if (response.status === HTTP_STATUS.NOT_FOUND) {
      throw new CalendarFetchError(
        "Calendar not found. Check that the URL is correct.",
        response.status,
      );
    }

    throw new CalendarFetchError(
      `Failed to fetch calendar (HTTP ${response.status})`,
      response.status,
    );
  }

  return response.text();
};

type ParsedCalendarResult = ReturnType<typeof parseIcsCalendar>;

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

/**
 * @throws
 */
async function pullRemoteCalendar(
  output: OutputJSON | OutputICal | OutputICALOrJSON,
  url: string,
  options?: SafeFetchOptions,
): Promise<JustICal | JustJSON | ICalOrJSON> {
  const outputs = normalizeOutputToArray(output);
  const normalizedUrl = normalizeCalendarUrl(url);
  const ical = await fetchRemoteText(normalizedUrl, options);
  const json = parseIcsCalendar({ icsString: ical });

  if (!json.version || !json.prodId) {
    throw new CalendarFetchError(
      "URL does not return a valid iCal file. Make sure the URL points directly to an .ics file.",
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

export { CalendarFetchError, pullRemoteCalendar };
