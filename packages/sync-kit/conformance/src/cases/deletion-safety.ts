import type {
  CalendarKey,
  Capabilities,
  ChangeListing,
  ProviderId,
  RemoteEvent,
} from "@keeper.sh/sync-protocol";
import { assertNoRemovalDerivable, derivableRemovals } from "../assertions/no-removal";
import type { KnownIdentity, KnownMirror } from "../assertions/no-removal";
import type { ConformanceCase } from "../registry/case";
import {
  caseScope,
  decadeWindow,
  defineCase,
  foreignEvent,
  insist,
  listChanges,
  listingOf,
  markedWith,
  objectsMarked,
  seedWith,
  uidsOf,
} from "./support";

const knownAt = (uid: string, day: string): KnownIdentity => ({
  uid,
  id: { kind: "remoteEventId", value: `id-${uid}` },
  time: {
    kind: "timed",
    start: { kind: "instant", value: `${day}T09:00:00.000Z` },
    end: { kind: "instant", value: `${day}T10:00:00.000Z` },
    zone: null,
  },
});

const RESUME_CEILING = 50;

const knownOf = (calendar: CalendarKey, uids: readonly string[]): KnownMirror => ({
  calendar,
  entries: uids.map((uid) => knownAt(uid, "2026-03-02")),
});

const presentIdentities = (listing: ChangeListing): readonly string[] => [
  ...uidsOf(listing),
  ...(listing.withheld ?? []).flatMap((entry) => {
    if (entry.uid === null) {
      return [];
    }
    return [entry.uid.value];
  }),
];

const namedRemovalUids = (listing: ChangeListing): readonly string[] =>
  (listing.removals ?? []).flatMap((removal) => {
    if (removal.kind === "outOfScope") {
      return [];
    }
    return [removal.uid.value];
  });

const withoutUid = (events: readonly RemoteEvent[], uid: string): readonly RemoteEvent[] =>
  events.filter((event) => event.uid.value !== uid);

const deletionSafetyCases = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
): readonly ConformanceCase<Provider>[] => [
  defineCase(supports, "CONF-O1", "a truncated read can never produce a removal", async (context) => {
    const scope = caseScope(context);
    const uids = ["alpha", "bravo", "charlie"].map((name) => markedWith("CONF-O1", name));
    await seedWith(
      context,
      uids.map((uid, index) =>
        foreignEvent(scope.calendar, {
          uid,
          start: `2026-03-0${index + 2}T09:00:00.000Z`,
          end: `2026-03-0${index + 2}T10:00:00.000Z`,
        }),
      ),
    );

    const answered = await listChanges(context, scope);
    if (!answered.ok) {
      return;
    }
    const listing = answered.value;
    if (listing.kind === "partial" || listing.kind === "cursorLost") {
      assertNoRemovalDerivable(listing);
      insist("CONF-O1", !listing.cursor, "an incomplete read still handed back a sync cursor");
      return;
    }
    const present = new Set(presentIdentities(listing));
    insist(
      "CONF-O1",
      uids.every((uid) => present.has(uid)),
      "a listing that claims coverage silently dropped events it never proved absent",
    );
  }),

  defineCase(
    supports,
    "CONF-O2",
    "a failed read and an empty calendar are distinguishable",
    async (context) => {
      const scope = caseScope(context);
      await seedWith(context, []);
      context.environment.transport.answerWith({
        kind: "reject",
        failure: { kind: "transport", status: 503, disposition: "transient" },
        times: 4,
      });
      const failed = await listChanges(context, scope);
      context.environment.transport.answerWith({ kind: "pass" });
      const empty = await listChanges(context, scope);

      insist("CONF-O2", !failed.ok, "a transport failure was answered as an authoritative listing");
      insist("CONF-O2", empty.ok, "an empty calendar was answered as a failure");
      insist(
        "CONF-O2",
        listingOf("CONF-O2", empty).kind === "snapshot",
        "an empty calendar must still prove the coverage it read",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O3",
    "deletion authority follows the declared discriminant",
    async (context) => {
      const scope = caseScope(context);
      const present = markedWith("CONF-O3", "present");
      const ghost = markedWith("CONF-O3", "ghost");
      await seedWith(context, [
        foreignEvent(scope.calendar, {
          uid: present,
          start: "2026-03-02T09:00:00.000Z",
          end: "2026-03-02T10:00:00.000Z",
        }),
      ]);

      const listing = listingOf("CONF-O3", await listChanges(context, scope));
      const derivable = derivableRemovals({
        listing,
        known: knownOf(scope.calendar, [present, ghost]),
        withinWindow: context.withinWindow,
      });

      if (supports.deletionAuthority === "snapshotAbsence") {
        insist(
          "CONF-O3",
          derivable.includes(ghost),
          "an identity absent from a proven snapshot was not treated as removed",
        );
        insist(
          "CONF-O3",
          !derivable.includes(present),
          "an identity the snapshot reported was treated as removed",
        );
        return;
      }
      insist(
        "CONF-O3",
        derivable.length === 0,
        "an adapter that only names its removals derived one from absence",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O4",
    "a requested window wider than proven coverage is never substituted for it",
    async (context) => {
      const scope = caseScope(context, decadeWindow);
      const seeded = markedWith("CONF-O4", "inside");
      await seedWith(context, [
        foreignEvent(scope.calendar, {
          uid: seeded,
          start: "2026-03-02T09:00:00.000Z",
          end: "2026-03-02T10:00:00.000Z",
        }),
      ]);

      const listing = listingOf("CONF-O4", await listChanges(context, scope));
      insist(
        "CONF-O4",
        listing.coverage?.calendar.calendar.value === scope.calendar.calendar.value,
        "coverage was proven for a calendar other than the one requested",
      );
      insist(
        "CONF-O4",
        listing.coverage?.covered.end.value !== scope.window.end.value,
        "the adapter claimed to cover a decade it never read",
      );
      insist(
        "CONF-O4",
        derivableRemovals({
          listing,
          known: knownOf(scope.calendar, [markedWith("CONF-O4", "ancient")]),
          withinWindow: context.withinWindow,
        }).length === 0,
        "a removal was derived inside a band the listing never covered",
      );
      await context.provider.contract.conformance.deletionInputsShareOneCalendar();
    },
  ),

  defineCase(supports, "CONF-O5", "a withheld event is present, not absent", async (context) => {
    const scope = caseScope(context);
    const withheld = markedWith("CONF-O5", "inverted");
    await seedWith(context, [
      foreignEvent(scope.calendar, {
        uid: withheld,
        start: "2026-03-05T10:00:00.000Z",
        end: "2026-03-05T09:00:00.000Z",
      }),
    ]);

    const listing = listingOf("CONF-O5", await listChanges(context, scope));
    insist(
      "CONF-O5",
      (listing.withheld ?? []).some((entry) => entry.uid?.value === withheld),
      "an unrepresentable event vanished from the listing instead of being withheld",
    );
    insist(
      "CONF-O5",
      derivableRemovals({
        listing,
        known: knownOf(scope.calendar, [withheld]),
        withinWindow: context.withinWindow,
      }).length === 0,
      "a withheld identity was derivable as a removal",
    );
  }),

  defineCase(
    supports,
    "CONF-O12",
    "corrupt known state demands a resync and emits zero removals",
    async (context) => {
      const scope = caseScope(context);
      const uid = markedWith("CONF-O12", "row");
      const feed = [
        foreignEvent(scope.calendar, {
          uid,
          start: "2026-03-02T09:00:00.000Z",
          end: "2026-03-02T10:00:00.000Z",
        }),
      ];
      await seedWith(context, feed);
      await listChanges(context, scope);
      await seedWith(context, feed, { corruptKnownRows: [uid] });

      const listing = listingOf("CONF-O12", await listChanges(context, scope));
      const repeated = listingOf("CONF-O12", await listChanges(context, scope));
      await seedWith(context, []);
      insist(
        "CONF-O12",
        listing.kind === "cursorLost",
        "corrupt known state was answered with an authoritative listing",
      );
      insist(
        "CONF-O12",
        (listing.removals ?? []).length === 0,
        "corrupt known state produced removals",
      );
      insist(
        "CONF-O12",
        repeated.kind === "cursorLost",
        "a feed identical to the previous poll was short-circuited past the corrupt row it had to recover",
      );
    },
  ),

  defineCase(supports, "CONF-O13", "an ambiguous removal is never a deletion", async (context) => {
    const scope = caseScope(context);
    const kept = markedWith("CONF-O13", "kept");
    const gone = markedWith("CONF-O13", "gone");
    const ambiguous = `id-${markedWith("CONF-O13", "ambiguous")}`;
    const seeded = [
      foreignEvent(scope.calendar, {
        uid: kept,
        start: "2026-03-02T09:00:00.000Z",
        end: "2026-03-02T10:00:00.000Z",
      }),
      foreignEvent(scope.calendar, {
        uid: gone,
        start: "2026-03-03T09:00:00.000Z",
        end: "2026-03-03T10:00:00.000Z",
      }),
    ];
    await seedWith(context, seeded);
    await listChanges(context, scope);
    await seedWith(context, withoutUid(seeded, gone), {
      unattributableRemovals: [ambiguous],
    });

    const listing = listingOf("CONF-O13", await listChanges(context, scope));
    const named = namedRemovalUids(listing);
    if (supports.removalsAreAmbiguous) {
      insist(
        "CONF-O13",
        named.length === 0 || listing.kind === "cursorLost",
        "an adapter whose removals are ambiguous still emitted an authoritative deletion",
      );
      return;
    }
    insist(
      "CONF-O13",
      named.includes(gone),
      "an identity the source really dropped was not named as removed",
    );
    insist(
      "CONF-O13",
      named.every((uid) => uid.length > 0),
      "an authoritative removal arrived without the identity it removes",
    );
    insist(
      "CONF-O13",
      !named.includes(ambiguous),
      "a tombstone the adapter could not attribute was still reported as an authoritative removal",
    );
  }),

  defineCase(
    supports,
    "CONF-O33",
    "a withheld identity does not cost the user its existing mirror",
    async (context) => {
      const scope = caseScope(context);
      const source = markedWith("CONF-O33", "source");
      const mirror = markedWith("CONF-O33", "mirror");
      await seedWith(context, [
        foreignEvent(scope.calendar, {
          uid: source,
          start: "2026-03-05T10:00:00.000Z",
          end: "2026-03-05T09:00:00.000Z",
        }),
        foreignEvent(scope.calendar, {
          uid: mirror,
          start: "2026-03-05T09:00:00.000Z",
          end: "2026-03-05T10:00:00.000Z",
        }),
      ]);

      const listing = listingOf("CONF-O33", await listChanges(context, scope));
      const survivors = await objectsMarked(context.provider, "CONF-O33");

      insist(
        "CONF-O33",
        (listing.withheld ?? []).some((entry) => entry.uid?.value === source),
        "the unrepresentable source was not withheld",
      );
      insist(
        "CONF-O33",
        survivors.some((event) => event.uid.value === mirror),
        "withholding a source destroyed the mirror the user still has",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O34",
    "cancelled, unnamed and out of scope are three different verdicts",
    async (context) => {
      const scope = caseScope(context);
      const kept = markedWith("CONF-O34", "kept");
      const cancelled = markedWith("CONF-O34", "cancelled");
      const seeded = [
        foreignEvent(scope.calendar, {
          uid: kept,
          start: "2026-03-02T09:00:00.000Z",
          end: "2026-03-02T10:00:00.000Z",
        }),
        foreignEvent(scope.calendar, {
          uid: cancelled,
          start: "2026-03-03T09:00:00.000Z",
          end: "2026-03-03T10:00:00.000Z",
        }),
      ];
      const unnamed = `id-${markedWith("CONF-O34", "unnamed")}`;
      await seedWith(context, seeded);
      await listChanges(context, scope);
      await seedWith(context, seeded, {
        cancelled: [cancelled],
        unattributableRemovals: [unnamed],
      });

      const listing = listingOf("CONF-O34", await listChanges(context, scope));
      const removals = listing.removals ?? [];
      const outOfScope = removals.filter((removal) => removal.kind === "outOfScope");
      insist(
        "CONF-O34",
        removals.some((removal) => removal.kind === "cancelled" && removal.uid.value === cancelled),
        "an identity the source reported as cancelled was not removed as a cancellation",
      );
      insist(
        "CONF-O34",
        !namedRemovalUids(listing).includes(kept),
        "an identity the source still reports was named as removed",
      );
      insist(
        "CONF-O34",
        outOfScope.every((removal) => removal.id.value === unnamed),
        "an identity the adapter could name was demoted to an out-of-scope marker",
      );
      insist(
        "CONF-O34",
        derivableRemovals({
          listing,
          known: knownOf(scope.calendar, [kept]),
          withinWindow: context.withinWindow,
        }).length === 0,
        "an out-of-scope marker drove a deletion of an identity the source still holds",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O41",
    "a resumed walk accounts for the pages it already handed back",
    async (context) => {
      const scope = caseScope(context);
      const seeded = Array.from({ length: 12 }, (unused, index) =>
        markedWith("CONF-O41", `seed-${index}`));

      await seedWith(context, seeded.map((uid, index) => foreignEvent(scope.calendar, {
        uid,
        start: `2026-03-${String((index % 27) + 1).padStart(2, "0")}T09:00:00.000Z`,
        end: `2026-03-${String((index % 27) + 1).padStart(2, "0")}T10:00:00.000Z`,
      })));

      /*
       * Walking to the end is the point. A listing that ends the walk claims authority over
       * the window, so every seeded identity must still be accounted for — an adapter that
       * resumes and reports only the pages after the resume point turns the earlier ones into
       * derivable deletions of events that are plainly still there.
       */
      const walk = {
        listing: listingOf("CONF-O41", await listChanges(context, scope)),
        walked: 0,
      };
      while (walk.listing.kind === "partial" && walk.walked < RESUME_CEILING) {
        const { listing: partial } = walk;
        insist(
          "CONF-O41",
          partial.continuation.kind === "continuation" && !partial.cursor,
          "a truncated page handed back a sync cursor instead of a continuation",
        );
        walk.walked += 1;
        walk.listing = listingOf(
          "CONF-O41",
          await listChanges(context, scope, partial.continuation),
        );
      }

      insist(
        "CONF-O41",
        walk.listing.kind !== "partial",
        "resuming from the continuation never reached a listing that proves coverage",
      );

      const derivable = derivableRemovals({
        listing: walk.listing,
        known: knownOf(scope.calendar, seeded),
        withinWindow: context.withinWindow,
      });

      insist(
        "CONF-O41",
        derivable.length === 0,
        `a completed walk made ${derivable.length} still-present identities derivable as`
        + ` removals, after ${walk.walked} resumption(s)`,
      );
    },
  ),
];

export { deletionSafetyCases, knownOf, namedRemovalUids, presentIdentities, withoutUid };
