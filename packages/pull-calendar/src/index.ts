import { fetch } from "bun";
import { convertIcsCalendar } from "ts-ics";

const fetchRemoteText = async (url: string) => {
  const response = await fetch(url);
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
  const ical = await fetchRemoteText(url);
  const json = convertIcsCalendar(undefined, ical);

  if (!json.version || !json.prodId) {
    throw new Error("Missing required calendar properties");
  }

  if (!outputs.includes("json")) {
    return { ical };
  }

  if (!outputs.includes("ical")) {
    return { json };
  }

  return { json, ical };
}
