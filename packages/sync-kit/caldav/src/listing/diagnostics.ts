import type { BoundedSample, ListingDiagnostics, WithheldEvent } from "@keeper.sh/sync-protocol";
import type { CalDAVFeed } from "./build-feed";

const boundedSample = (values: readonly string[], ceiling: number): BoundedSample => ({
  sample: values.slice(0, ceiling),
  total: values.length,
});

const identifierOf = (entry: WithheldEvent): string => {
  if (entry.uid === null) {
    return entry.id.value;
  }
  return entry.uid.value;
};

const unrepresentableReasons = ["unrepresentableTime", "unsupportedRecurrenceRange"] as const;

const unrepresentableIn = (withheld: readonly WithheldEvent[]): readonly string[] =>
  withheld
    .filter((entry) => unrepresentableReasons.some((reason) => reason === entry.reason))
    .map((entry) => identifierOf(entry));

const caldavDiagnostics = (
  feed: CalDAVFeed,
  pagesFetched: number,
  ceiling: number,
): ListingDiagnostics => ({
  withheld: boundedSample(feed.withheld.map((entry) => identifierOf(entry)), ceiling),
  selfAuthored: boundedSample(feed.selfAuthored, ceiling),
  unrepresentable: boundedSample(unrepresentableIn(feed.withheld), ceiling),
  pagesFetched,
});

export { boundedSample, caldavDiagnostics, identifierOf };
