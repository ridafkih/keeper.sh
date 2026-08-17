import type { Event as GraphEvent } from "@microsoft/microsoft-graph-types";
import { readBody } from "../decode/body";

interface BodyRegions {
  readonly authored: string;
  readonly providerOwned: string | null;
}

/*
 * Outlook owns the block it fences with two rules of underscores when an event is an online
 * meeting, rewrites it on its own schedule, and drops the join details when a write replaces it.
 * https://learn.microsoft.com/en-us/graph/api/resources/onlinemeetinginfo
 */
const providerOwnedRegion = /_{20,}\r?\n[\s\S]*?\r?\n_{20,}/;

const trimmedEnds = (value: string): string => value.replaceAll(/^\s+|\s+$/g, "");

const splitBodyRegions = (event: GraphEvent): BodyRegions => {
  const body = readBody(event.body ?? null);
  if (body.kind !== "comparable") {
    return { authored: "", providerOwned: null };
  }
  const matched = providerOwnedRegion.exec(body.text);
  if (!matched) {
    return { authored: body.text, providerOwned: null };
  }
  const [region] = matched;
  return { authored: trimmedEnds(body.text.replace(region, "")), providerOwned: region };
};

const withPreservedRegion = (authored: string, providerOwned: string | null): string => {
  if (providerOwned === null) {
    return authored;
  }
  if (authored.length === 0) {
    return providerOwned;
  }
  return `${authored}\n${providerOwned}`;
};

const withoutProviderRegion = (event: GraphEvent): GraphEvent => {
  const regions = splitBodyRegions(event);
  if (regions.providerOwned === null) {
    return event;
  }
  return { ...event, body: { contentType: "text", content: regions.authored } };
};

export { splitBodyRegions, withoutProviderRegion, withPreservedRegion };
export type { BodyRegions };
