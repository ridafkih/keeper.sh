import { fetch } from "bun";
import { convertIcsCalendar } from "ts-ics";

const normalizeCalendarUrl = (url: string): string => {
  if (url.startsWith("webcal://")) {
    return url.replace("webcal://", "https://");
  }

  return url;
};

export class CalendarFetchError extends Error {
  public readonly authRequired: boolean;

  constructor(
    message: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = "CalendarFetchError";
    this.authRequired = statusCode === 401 || statusCode === 403;
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

  return { url: parsed.toString(), headers };
};

const fetchRemoteText = async (url: string) => {
  const { url: cleanUrl, headers } = parseUrlWithCredentials(url);
  const response = await fetch(cleanUrl, { headers });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new CalendarFetchError(
        "Calendar requires authentication. Use a public URL or include credentials in the URL (https://user:pass@host/path).",
        response.status,
      );
    }

    if (response.status === 404) {
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

type ParsedCalendarResult = ReturnType<typeof convertIcsCalendar>;

type OutputICal = "ical" | ["ical"];
type OutputJSON = "json" | ["json"];
type OutputICALOrJSON = ["ical", "json"] | ["json", "ical"];

type JustICal = { ical: string; json?: never };
type JustJSON = { json: ParsedCalendarResult; ical?: never };
type ICalOrJSON = Omit<JustICal, "json"> & Omit<JustJSON, "ical">;

export async function pullRemoteCalendar(
  output: OutputICal,
  url: string,
): Promise<JustICal>;

export async function pullRemoteCalendar(
  output: OutputJSON,
  url: string,
): Promise<JustJSON>;

export async function pullRemoteCalendar(
  output: OutputICALOrJSON,
  url: string,
): Promise<ICalOrJSON>;

/**
 * @throws
 */
export async function pullRemoteCalendar(
  output: OutputJSON | OutputICal | OutputICALOrJSON,
  url: string,
): Promise<JustICal | JustJSON | ICalOrJSON> {
  const outputs = typeof output === "string" ? [output] : output;
  const normalizedUrl = normalizeCalendarUrl(url);
  const ical = await fetchRemoteText(normalizedUrl);
  const json = convertIcsCalendar(undefined, ical);

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

  return { json, ical };
}
