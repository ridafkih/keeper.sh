import type { Capabilities, ChangeListing, ProviderId } from "@keeper.sh/sync-protocol";
import { canonicalise } from "../canonical";
import type { ConformanceCase } from "../registry/case";
import { namedRemovalUids, withoutUid } from "./deletion-safety";
import {
  caseScope,
  defineCase,
  foreignEvent,
  insist,
  listChanges,
  listingOf,
  markedWith,
  seedWith,
  uidsOf,
} from "./support";

const repeatableShapeOf = (listing: ChangeListing): string =>
  canonicalise({
    withheld: (listing.withheld ?? []).map((entry) => ({
      uid: entry.uid?.value ?? null,
      reason: entry.reason,
    })),
    diagnostics: {
      withheld: [...listing.diagnostics.withheld.sample],
      total: listing.diagnostics.withheld.total,
      pagesFetched: listing.diagnostics.pagesFetched,
    },
  });

const isolationCases = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
): readonly ConformanceCase<Provider>[] => [
  defineCase(
    supports,
    "CONF-O6",
    "one unusable item does not stall the feed, and a real deletion in the same payload still applies",
    async (context) => {
      const scope = caseScope(context);
      const usable = markedWith("CONF-O6", "usable");
      const unusable = markedWith("CONF-O6", "unusable");
      const doomed = markedWith("CONF-O6", "doomed");
      const seeded = [
        foreignEvent(scope.calendar, {
          uid: usable,
          start: "2026-03-02T09:00:00.000Z",
          end: "2026-03-02T10:00:00.000Z",
        }),
        foreignEvent(scope.calendar, {
          uid: unusable,
          start: "2026-03-03T10:00:00.000Z",
          end: "2026-03-03T09:00:00.000Z",
        }),
        foreignEvent(scope.calendar, {
          uid: doomed,
          start: "2026-03-04T09:00:00.000Z",
          end: "2026-03-04T10:00:00.000Z",
        }),
      ];

      await seedWith(context, seeded);
      const first = listingOf("CONF-O6", await listChanges(context, scope));
      insist(
        "CONF-O6",
        uidsOf(first).includes(usable),
        "one unusable item threw the usable items out of the listing",
      );

      await seedWith(context, withoutUid(seeded, doomed));
      const second = listingOf("CONF-O6", await listChanges(context, scope));
      insist(
        "CONF-O6",
        namedRemovalUids(second).includes(doomed),
        "a real deletion delivered beside an unusable item was never expressed",
      );

      const third = listingOf("CONF-O6", await listChanges(context, scope));
      insist(
        "CONF-O6",
        repeatableShapeOf(third) === repeatableShapeOf(second),
        "polling the same malformed feed twice produced two different answers",
      );
    },
  ),
];

export { isolationCases };
