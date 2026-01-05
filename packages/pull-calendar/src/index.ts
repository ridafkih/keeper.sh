import { fetch } from "bun";
import { parseIcsCalendar } from "@keeper.sh/calendar";

const fetchRemoteText = async (url: string): Promise<string> => {
  const response = await fetch(url);
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

async function pullRemoteCalendar(output: OutputICal, url: string): Promise<JustICal>;

async function pullRemoteCalendar(output: OutputJSON, url: string): Promise<JustJSON>;

async function pullRemoteCalendar(output: OutputICALOrJSON, url: string): Promise<ICalOrJSON>;

/**
 * @throws
 */
async function pullRemoteCalendar(
  output: OutputJSON | OutputICal | OutputICALOrJSON,
  url: string,
): Promise<JustICal | JustJSON | ICalOrJSON> {
  const outputs = normalizeOutputToArray(output);
  const ical = await fetchRemoteText(url);
  const json = parseIcsCalendar({ icsString: ical });

  if (!json.version || !json.prodId) {
    throw new Error("Missing required calendar properties");
  }

  if (!outputs.includes("json")) {
    return { ical };
  }

  if (!outputs.includes("ical")) {
    return { json };
  }

  return { ical, json };
}

export { pullRemoteCalendar };
