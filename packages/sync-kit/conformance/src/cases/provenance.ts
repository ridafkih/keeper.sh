import type { Capabilities, ProviderId, RemoteEvent } from "@keeper.sh/sync-protocol";
import { canonicalise } from "../canonical";
import type { ConformanceCase } from "../registry/case";
import { derivableRemovals } from "../assertions/no-removal";
import { knownOf } from "./deletion-safety";
import { createIntent } from "./intents";
import {
  caseScope,
  defineCase,
  foreignEvent,
  insist,
  listChanges,
  listingOf,
  markedWith,
  objectsMarked,
  seedWith,
  write,
} from "./support";
import { meetingAt } from "./writes";

const summaryOf = (events: readonly RemoteEvent[]): string =>
  canonicalise(
    events.map((event) => ({
      uid: event.uid.value,
      revision: event.revision,
      version: event.version.value,
      fingerprint: event.fingerprint.value,
      title: event.content.title,
    })),
  );

const provenanceCases = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
): readonly ConformanceCase<Provider>[] => [
  defineCase(
    supports,
    "CONF-O16",
    "our own provenance survives a round trip through the adapter",
    async (context) => {
      const scope = caseScope(context);
      const key = markedWith("CONF-O16", "mirror");
      await seedWith(context, []);
      await write(
        context,
        createIntent(
          supports,
          scope.calendar,
          context.environment.installation,
          key,
          meetingAt(key, "09"),
        ),
      );

      const listing = listingOf("CONF-O16", await listChanges(context, scope));
      const mirrored = (listing.events ?? []).find((event) => event.uid.value === key);
      insist("CONF-O16", Boolean(mirrored), "an event we wrote did not come back through the adapter");
      if (!mirrored) {
        return;
      }
      if (supports.provenanceChannel === "none") {
        insist(
          "CONF-O16",
          mirrored.provenance.kind === "indeterminate",
          "an adapter with no provenance channel claimed to know who authored the event",
        );
        insist(
          "CONF-O16",
          derivableRemovals({
            listing,
            known: knownOf(scope.calendar, [key]),
            withinWindow: context.withinWindow,
          }).length === 0,
          "an event of indeterminate provenance was derivable as a removal",
        );
        return;
      }
      insist(
        "CONF-O16",
        mirrored.provenance.kind === "ours",
        "an event we wrote came back without our provenance, so we would mirror it again",
      );
      insist(
        "CONF-O16",
        mirrored.provenance.kind !== "ours" ||
          mirrored.provenance.installation.value === context.environment.installation.value,
        "an event we wrote came back carrying somebody else's installation",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O17",
    "a foreign event survives every reconciliation the suite can generate",
    async (context) => {
      const scope = caseScope(context);
      const canary = markedWith("CONF-O17", "canary");
      const mine = markedWith("CONF-O17", "mine");
      await seedWith(context, [
        foreignEvent(scope.calendar, {
          uid: canary,
          start: "2026-03-06T09:00:00.000Z",
          end: "2026-03-06T10:00:00.000Z",
        }),
      ]);
      const before = await objectsMarked(context.provider, "CONF-O17");

      await write(
        context,
        createIntent(
          supports,
          scope.calendar,
          context.environment.installation,
          mine,
          meetingAt(mine, "09"),
        ),
      );
      await listChanges(context, scope);
      const after = await objectsMarked(context.provider, "CONF-O17");
      const survivors = after.filter((event) => event.uid.value === canary);

      insist("CONF-O17", survivors.length === 1, "the foreign canary did not survive the run");
      insist(
        "CONF-O17",
        summaryOf(survivors) === summaryOf(before.filter((event) => event.uid.value === canary)),
        "the foreign canary came out of the run changed",
      );
    },
  ),
];

export { provenanceCases, summaryOf };
