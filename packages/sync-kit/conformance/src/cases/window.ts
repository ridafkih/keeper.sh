import type {
  Capabilities,
  ChangeListing,
  EventTime,
  ProviderId,
  RemoteEvent,
  TimeWindow,
} from "@keeper.sh/sync-protocol";
import { derivableRemovals } from "../assertions/no-removal";
import type { KnownIdentity } from "../assertions/no-removal";
import type { CaseContext, ConformanceCase } from "../registry/case";
import { createIntent } from "./intents";
import { refusedWith } from "./capabilities";
import type { EventDraft } from "./support";
import {
  caseScope,
  contentOf,
  defineCase,
  foreignEvent,
  insist,
  invertedWindow,
  listChanges,
  listingOf,
  markedWith,
  objectsMarked,
  seedWith,
  uidsOf,
  write,
} from "./support";

const timeOf = (event: RemoteEvent): EventTime | null => event.content.time ?? null;

const meetsMinimumSpan = (time: EventTime | null, seconds: number): boolean => {
  if (time === null) {
    return false;
  }
  if (time.kind === "allDay") {
    return true;
  }
  return Date.parse(time.end.value) - Date.parse(time.start.value) >= seconds * 1000;
};

const knownFrom = (events: readonly RemoteEvent[]): readonly KnownIdentity[] =>
  events.flatMap((event) => {
    const time = timeOf(event);
    if (time === null) {
      return [];
    }
    return [{ uid: event.uid.value, id: event.id, time }];
  });

const coveredWindowOf = (listing: ChangeListing, requested: TimeWindow): TimeWindow =>
  listing.coverage?.covered ?? requested;

const hourMs = 60 * 60 * 1000;

const draftSpanning = (name: string, startMs: number, endMs: number): EventDraft => ({
  uid: markedWith("CONF-O27", name),
  start: new Date(startMs).toISOString(),
  end: new Date(endMs).toISOString(),
});

const boundaryDrafts = (window: TimeWindow): readonly EventDraft[] => {
  const lower = Date.parse(window.start.value);
  const upper = Date.parse(window.end.value);
  return [
    draftSpanning("onLowerEdge", lower, lower + hourMs),
    draftSpanning("beforeLowerEdge", lower - 2 * hourMs, lower - hourMs),
    draftSpanning("onUpperEdge", upper - hourMs, upper),
    draftSpanning("pastUpperEdge", upper + hourMs, upper + 2 * hourMs),
    draftSpanning("zeroDuration", lower + hourMs, lower + hourMs),
  ];
};

const degenerateSeed = <Provider extends ProviderId>(
  context: CaseContext<Provider>,
  uid: string,
): readonly RemoteEvent[] => [
  foreignEvent(caseScope(context).calendar, {
    uid,
    start: "2026-03-10T09:00:00.000Z",
    end: "2026-03-10T09:00:00.000Z",
  }),
];

const windowCases = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
): readonly ConformanceCase<Provider>[] => [
  defineCase(
    supports,
    "CONF-O26",
    "an event the source still holds outside the window is never removed by its absence",
    async (context) => {
      const scope = caseScope(context);
      const outside = markedWith("CONF-O26", "outside");
      const seeded = [
        foreignEvent(scope.calendar, {
          uid: outside,
          start: "2026-05-02T09:00:00.000Z",
          end: "2026-05-02T10:00:00.000Z",
        }),
      ];
      await seedWith(context, seeded);

      const listing = listingOf("CONF-O26", await listChanges(context, scope));
      const covered = coveredWindowOf(listing, scope.window);
      const reported = uidsOf(listing).includes(outside);
      const known = knownFrom(seeded);
      const outsideCoverage = known.every((entry) => !context.withinWindow(covered, entry.time));

      insist(
        "CONF-O26",
        reported || outsideCoverage,
        "an event the source still holds was neither reported nor left outside the proven coverage",
      );
      insist(
        "CONF-O26",
        derivableRemovals({
          listing,
          known: { calendar: scope.calendar, entries: known },
          withinWindow: context.withinWindow,
        }).length === 0,
        "an event outside the requested window was derivable as a removal",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O27",
    "one window predicate, agreeing at every boundary and at removal time",
    async (context) => {
      const scope = caseScope(context);
      const edges = boundaryDrafts(scope.window).map((draft) =>
        foreignEvent(scope.calendar, draft),
      );
      await seedWith(context, edges);

      const listing = listingOf("CONF-O27", await listChanges(context, scope));
      const listed = new Set(uidsOf(listing));
      const covered = coveredWindowOf(listing, scope.window);
      for (const event of edges) {
        const time = timeOf(event);
        if (time === null) {
          continue;
        }
        insist(
          "CONF-O27",
          !context.withinWindow(scope.window, time) || listed.has(event.uid.value),
          "an event the window predicate admits was left out of the listing that predicate scoped",
        );
        insist(
          "CONF-O27",
          context.withinWindow(covered, time) ||
            !derivableRemovals({
              listing,
              known: { calendar: scope.calendar, entries: knownFrom([event]) },
              withinWindow: context.withinWindow,
            }).includes(event.uid.value),
          "an event the window predicate excludes was still derivable as a removal",
        );
      }

      const second = listingOf("CONF-O27", await listChanges(context, scope));
      insist(
        "CONF-O27",
        new Set(uidsOf(second)).size === listed.size,
        "two polls of the same boundary set disagreed about which events the window admits",
      );

      const degenerate = listingOf(
        "CONF-O27",
        await listChanges(context, caseScope(context, invertedWindow)),
      );
      insist(
        "CONF-O27",
        (degenerate.events ?? []).length === 0,
        "an inverted window admitted events it could never have proven",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O28",
    "a degenerate range is preserved or refused, never silently widened at the source",
    async (context) => {
      const scope = caseScope(context);
      const uid = markedWith("CONF-O28", "degenerate");
      const written = markedWith("CONF-O28", "mirrored");
      await seedWith(context, degenerateSeed(context, uid));

      const listing = listingOf("CONF-O28", await listChanges(context, scope));
      const zeroDuration = contentOf({
        uid: written,
        start: "2026-03-11T09:00:00.000Z",
        end: "2026-03-11T09:00:00.000Z",
      });
      const mirrored = await write(
        context,
        createIntent(
          supports,
          scope.calendar,
          context.environment.installation,
          written,
          zeroDuration,
        ),
      );

      if (supports.representableRange.zeroDuration === "reject") {
        insist(
          "CONF-O28",
          (listing.withheld ?? []).some((entry) => entry.uid?.value === uid),
          "a zero-duration event the adapter cannot represent was silently widened",
        );
        insist(
          "CONF-O28",
          refusedWith(mirrored, "minimumSpan"),
          "an adapter that cannot represent a zero-duration span accepted one anyway",
        );
        return;
      }

      insist(
        "CONF-O28",
        uidsOf(listing).includes(uid),
        "a zero-duration event the adapter accepts was dropped from the listing",
      );
      insist("CONF-O28", mirrored.ok, "a zero-duration event the adapter accepts was refused");
      const stored = await objectsMarked(context.provider, "CONF-O28");
      const widened = stored.find((event) => event.uid.value === written);
      insist(
        "CONF-O28",
        meetsMinimumSpan(
          widened?.content.time ?? null,
          supports.representableRange.minimumSpanSeconds,
        ),
        "the destination copy was stored below the minimum span the adapter declared",
      );

      const replayed = await write(
        context,
        createIntent(
          supports,
          scope.calendar,
          context.environment.installation,
          written,
          zeroDuration,
        ),
      );
      const afterwards = await objectsMarked(context.provider, "CONF-O28");
      const unchanged = afterwards.find((event) => event.uid.value === written);
      insist(
        "CONF-O28",
        replayed.ok && replayed.value.kind !== "created",
        "the widening the destination performed read back as a change and was written again",
      );
      insist(
        "CONF-O28",
        unchanged?.revision === widened?.revision,
        "a second run against a widened mirror revised the copy it had already written",
      );
    },
  ),
];

export { windowCases };
