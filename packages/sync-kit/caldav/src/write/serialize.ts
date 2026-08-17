import type { SerialisedResource } from "@keeper.sh/sync-ical";
import { serialiseCalendarResource } from "@keeper.sh/sync-ical";
import type { EventUid, NormalizedContent } from "@keeper.sh/sync-protocol";
import { caldavIcsOptions } from "../canonical";
import type { CalDAVDependencies } from "../dependencies";

const firstRevision = 1;

const nextSequence = (replacedRevision: number | null): number => {
  if (replacedRevision === null) {
    return firstRevision;
  }
  return replacedRevision + 1;
};

const serializeResource = (
  dependencies: CalDAVDependencies,
  uid: EventUid,
  content: NormalizedContent<"caldav">,
  replacedRevision: number | null,
): SerialisedResource =>
  serialiseCalendarResource(
    {
      master: {
        identity: { kind: "master", uid },
        content: content.content,
        cancellations: [],
      },
      overrides: [],
      sequence: nextSequence(replacedRevision),
    },
    caldavIcsOptions(dependencies, "includeForRoundTrip"),
  );

export { serializeResource };
