import type {
  BoundedSample,
  Capabilities,
  ListingDiagnostics,
  ProviderId,
  RemoteEvent,
} from "@keeper.sh/sync-protocol";
import { assertNoContentInDiagnostics } from "../assertions/listing";
import { canonicalise } from "../canonical";
import { conformanceLimits } from "../limits";
import type { ConformanceCase } from "../registry/case";
import { createIntent } from "./intents";
import {
  caseScope,
  defineCase,
  foreignEvent,
  insist,
  listChanges,
  listingOf,
  markedWith,
  seedWith,
  write,
} from "./support";
import { meetingAt } from "./writes";

const totalsOf = (diagnostics: ListingDiagnostics): readonly number[] => [
  diagnostics.withheld.total,
  diagnostics.selfAuthored.total,
  diagnostics.unrepresentable.total,
];

const utf16LengthOf = (sample: BoundedSample): number =>
  sample.sample.reduce((total, entry) => total + entry.length, 0);

const unrepresentableAt = (
  calendar: RemoteEvent["calendar"],
  uid: string,
  title: string,
): RemoteEvent =>
  foreignEvent(calendar, {
    uid,
    title,
    start: "2026-03-05T10:00:00.000Z",
    end: "2026-03-05T09:00:00.000Z",
  });

const diagnosticsCases = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
): readonly ConformanceCase<Provider>[] => [
  defineCase(
    supports,
    "CONF-O19",
    "no event content ever appears in the loggable half of a listing",
    async (context) => {
      const scope = caseScope(context);
      const secret = "Board comp review with Alex";
      await seedWith(context, [
        unrepresentableAt(scope.calendar, markedWith("CONF-O19", "secretive"), secret),
      ]);

      const listing = listingOf("CONF-O19", await listChanges(context, scope));
      assertNoContentInDiagnostics(listing, [secret]);
    },
  ),

  defineCase(
    supports,
    "CONF-O30",
    "counters are separated, zero on a clean run, and stable across identical polls",
    async (context) => {
      const scope = caseScope(context);
      await seedWith(context, [
        foreignEvent(scope.calendar, {
          uid: markedWith("CONF-O30", "benign"),
          start: "2026-03-03T09:00:00.000Z",
          end: "2026-03-03T10:00:00.000Z",
        }),
      ]);
      const clean = listingOf("CONF-O30", await listChanges(context, scope));
      insist(
        "CONF-O30",
        totalsOf(clean.diagnostics).every((total) => total === 0),
        "a listing with nothing to report still counted something",
      );

      const key = markedWith("CONF-O30", "ours");
      await seedWith(context, [
        unrepresentableAt(scope.calendar, markedWith("CONF-O30", "inverted"), "Inverted"),
      ]);
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

      const mixed = listingOf("CONF-O30", await listChanges(context, scope));
      insist(
        "CONF-O30",
        mixed.diagnostics.selfAuthored.total === 1,
        "our own mirror was not counted separately from what the adapter could not represent",
      );
      insist(
        "CONF-O30",
        mixed.diagnostics.unrepresentable.total === 1,
        "the unrepresentable counter folded in something that was not unrepresentable",
      );

      const repeated = listingOf("CONF-O30", await listChanges(context, scope));
      insist(
        "CONF-O30",
        canonicalise(totalsOf(repeated.diagnostics)) === canonicalise(totalsOf(mixed.diagnostics)),
        "two identical polls reported two different sets of counters",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O31",
    "diagnostics are a bounded sample beside an exact total",
    async (context) => {
      const scope = caseScope(context);
      const many = [...Array.from({ length: 200 }).keys()].map((index) =>
        unrepresentableAt(
          scope.calendar,
          markedWith("CONF-O31", `withheld-${index}`),
          `Withheld ${index}`,
        ),
      );
      await seedWith(context, [
        ...many,
        unrepresentableAt(
          scope.calendar,
          markedWith("CONF-O31", "x".repeat(50_000)),
          "Pathological identifier",
        ),
      ]);

      const listing = listingOf("CONF-O31", await listChanges(context, scope));
      insist(
        "CONF-O31",
        listing.diagnostics.withheld.total === many.length + 1,
        "the total beside the sample was capped along with the sample",
      );
      insist(
        "CONF-O31",
        listing.diagnostics.withheld.sample.length <= conformanceLimits.diagnosticSampleEntries,
        "the diagnostic sample was not bounded by its entry count",
      );
      insist(
        "CONF-O31",
        utf16LengthOf(listing.diagnostics.withheld) <=
          conformanceLimits.diagnosticSampleUtf16Length,
        "one pathological identifier pushed the diagnostic sample past its length budget",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O32",
    "a discard the adapter cannot name is still reported",
    async (context) => {
      const scope = caseScope(context);
      await seedWith(context, [
        foreignEvent(scope.calendar, {
          uid: "",
          title: "No identity at all",
          start: "2026-03-06T09:00:00.000Z",
          end: "2026-03-06T10:00:00.000Z",
        }),
      ]);

      const listing = listingOf("CONF-O32", await listChanges(context, scope));
      insist(
        "CONF-O32",
        (listing.withheld ?? []).some(
          (entry) => entry.uid === null && entry.reason === "missingIdentity",
        ),
        "an event with no identity was dropped without being reported",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O42",
    "a failed run leaks no state into the run that follows it",
    async (context) => {
      const scope = caseScope(context);
      await seedWith(context, [
        foreignEvent(scope.calendar, {
          uid: markedWith("CONF-O42", "benign"),
          start: "2026-03-03T09:00:00.000Z",
          end: "2026-03-03T10:00:00.000Z",
        }),
      ]);
      context.environment.transport.answerWith({
        kind: "reject",
        failure: { kind: "transport", status: 500, disposition: "permanent" },
        times: 1,
      });
      await listChanges(context, scope);
      context.environment.transport.answerWith({ kind: "pass" });

      const recovered = listingOf("CONF-O42", await listChanges(context, scope));
      insist(
        "CONF-O42",
        recovered.diagnostics.pagesFetched === 1,
        "the run that followed a failure counted the failed run's pages as its own",
      );
      insist(
        "CONF-O42",
        totalsOf(recovered.diagnostics).every((total) => total === 0),
        "the run that followed a failure inherited its counters",
      );
    },
  ),
];

export { diagnosticsCases, totalsOf, unrepresentableAt, utf16LengthOf };
