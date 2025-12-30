import { fetch } from "bun";
import { convertIcsCalendar } from "ts-ics";
import { log } from "@keeper.sh/log";

const normalizeCalendarUrl = (url: string): string => {
  if (url.startsWith("webcal://")) {
    return url.replace("webcal://", "https://");
  }

  return url;
};

export class CalendarFetchError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = "CalendarFetchError";
  }
}

const fetchRemoteText = async (url: string) => {
  log.trace("fetchRemoteText for '%s' started", url);
  const response = await fetch(url);

  if (!response.ok) {
    log.debug(
      "fetchRemoteText for '%s' failed with status %d",
      url,
      response.status,
    );

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

  const text = await response.text();
  log.trace("fetchRemoteText for '%s' complete", url);
  return text;
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
