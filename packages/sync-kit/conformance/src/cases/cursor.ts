import type {
  Capabilities,
  ChangeListing,
  ProviderId,
  RemoteEvent,
  Result,
  SyncCursor,
} from "@keeper.sh/sync-protocol";
import type { ConformanceCaseId } from "../case-id";
import type { CaseContext, ConformanceCase } from "../registry/case";
import {
  caseScope,
  decadeWindow,
  defineCase,
  failureKindOf,
  foreignEvent,
  insist,
  listChanges,
  listingOf,
  markedWith,
  seedWith,
} from "./support";

const cursorOf = (listing: ChangeListing): SyncCursor | null => listing.cursor ?? null;

const isLostOrRefused = (answered: Result<ChangeListing>): boolean => {
  if (!answered.ok) {
    return answered.failure.kind === "cursorInvalid";
  }
  return answered.value.kind === "cursorLost";
};

const eventNamed = (listing: ChangeListing, uid: string): RemoteEvent | undefined =>
  (listing.events ?? []).find((event) => event.uid.value === uid);

const mintedBy = <Provider extends ProviderId>(
  id: ConformanceCaseId,
  context: CaseContext<Provider>,
  listing: ChangeListing,
): SyncCursor | null => {
  const cursor = cursorOf(listing);
  if (context.supports.delta.kind === "none") {
    insist(
      id,
      cursor === null,
      "an adapter that declares no delta support handed back a sync cursor to resume from",
    );
    return null;
  }
  insist(
    id,
    cursor !== null,
    "an adapter that declares tokenized delta support proved coverage without minting a cursor",
  );
  return cursor;
};

const cursorCases = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
): readonly ConformanceCase<Provider>[] => [
  defineCase(
    supports,
    "CONF-O10",
    "a cursor the adapter can no longer honour discards the pagination and carries no tombstones",
    async (context) => {
      const scope = caseScope(context);
      await seedWith(context, [
        foreignEvent(scope.calendar, {
          uid: markedWith("CONF-O10", "alpha"),
          start: "2026-03-02T09:00:00.000Z",
          end: "2026-03-02T10:00:00.000Z",
        }),
      ]);

      const first = mintedBy("CONF-O10", context, listingOf("CONF-O10", await listChanges(context, scope)));
      if (first === null) {
        return;
      }
      await listChanges(context, scope);
      const replayed = await listChanges(context, scope, first);

      insist(
        "CONF-O10",
        isLostOrRefused(replayed),
        "a cursor the adapter had already superseded was still honoured",
      );
      if (!replayed.ok) {
        return;
      }
      insist(
        "CONF-O10",
        (replayed.value.events ?? []).length === 0 && (replayed.value.removals ?? []).length === 0,
        "a lost cursor leaked events or tombstones from a pagination it abandoned",
      );
      insist(
        "CONF-O10",
        !replayed.value.cursor,
        "a lost cursor was answered with a fresh cursor rather than a demand to resync",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O11",
    "a cursor minted under one window is refused when the window changes",
    async (context) => {
      const scope = caseScope(context);
      await seedWith(context, [
        foreignEvent(scope.calendar, {
          uid: markedWith("CONF-O11", "alpha"),
          start: "2026-03-02T09:00:00.000Z",
          end: "2026-03-02T10:00:00.000Z",
        }),
      ]);
      const minted = mintedBy("CONF-O11", context, listingOf("CONF-O11", await listChanges(context, scope)));
      if (minted === null) {
        return;
      }

      const widened = await listChanges(context, caseScope(context, decadeWindow), minted);
      if (supports.delta.kind === "tokenized" && supports.delta.windowBoundToCursor) {
        insist(
          "CONF-O11",
          isLostOrRefused(widened),
          "a cursor minted under a narrower window was replayed against a wider one",
        );
        return;
      }
      insist(
        "CONF-O11",
        widened.ok || failureKindOf(widened) === "cursorInvalid",
        "a window-free cursor answered with an untyped failure",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O24",
    "a run that did not complete never advances the sync frontier",
    async (context) => {
      const scope = caseScope(context);
      const first = markedWith("CONF-O24", "first");
      const second = markedWith("CONF-O24", "second");
      const alpha = foreignEvent(scope.calendar, {
        uid: first,
        start: "2026-03-02T09:00:00.000Z",
        end: "2026-03-02T10:00:00.000Z",
      });
      await seedWith(context, [alpha]);
      const minted = mintedBy("CONF-O24", context, listingOf("CONF-O24", await listChanges(context, scope)));
      if (minted === null) {
        return;
      }

      await seedWith(context, [
        alpha,
        foreignEvent(scope.calendar, {
          uid: second,
          start: "2026-03-03T09:00:00.000Z",
          end: "2026-03-03T10:00:00.000Z",
        }),
      ]);
      context.environment.transport.answerWith({
        kind: "reject",
        failure: { kind: "transport", status: 500, disposition: "permanent" },
        times: 1,
      });
      await listChanges(context, scope, minted);
      context.environment.transport.answerWith({ kind: "pass" });

      const resumed = listingOf("CONF-O24", await listChanges(context, scope, minted));
      insist(
        "CONF-O24",
        resumed.kind !== "delta" || Boolean(eventNamed(resumed, second)),
        "the frontier moved past a change the failed run never delivered",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O37",
    "a quiet calendar still advances its cursor",
    async (context) => {
      const scope = caseScope(context);
      await seedWith(context, [
        foreignEvent(scope.calendar, {
          uid: markedWith("CONF-O37", "alpha"),
          start: "2026-03-02T09:00:00.000Z",
          end: "2026-03-02T10:00:00.000Z",
        }),
      ]);
      const minted = mintedBy("CONF-O37", context, listingOf("CONF-O37", await listChanges(context, scope)));
      if (minted === null) {
        return;
      }
      const before = await context.provider.inspect();

      const quiet = listingOf("CONF-O37", await listChanges(context, scope, minted));
      const after = await context.provider.inspect();

      insist(
        "CONF-O37",
        cursorOf(quiet)?.value !== minted.value,
        "a poll that found nothing handed back the cursor it was given, so the feed never moves on",
      );
      insist(
        "CONF-O37",
        after.writeLog.length === before.writeLog.length,
        "a quiet poll wrote to the calendar",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O38",
    "a delta item is a patch and never blanks the fields it omits",
    async (context) => {
      const scope = caseScope(context);
      const uid = markedWith("CONF-O38", "patched");
      const draft = {
        uid,
        start: "2026-03-02T09:00:00.000Z",
        end: "2026-03-02T10:00:00.000Z",
        description: "the description the patch omits",
        location: "the location the patch omits",
      };
      await seedWith(context, [foreignEvent(scope.calendar, { ...draft, title: "Before" })]);
      const minted = mintedBy("CONF-O38", context, listingOf("CONF-O38", await listChanges(context, scope)));
      if (minted === null) {
        return;
      }

      await seedWith(context, [
        foreignEvent(scope.calendar, { ...draft, title: "After", revision: 2 }),
      ]);
      const delta = listingOf("CONF-O38", await listChanges(context, scope, minted));
      const patched = eventNamed(delta, uid);
      if (!patched) {
        return;
      }
      insist(
        "CONF-O38",
        patched.content.description === draft.description &&
          patched.content.location === draft.location,
        "a sparse delta item blanked the fields it never carried",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O40",
    "an unrecognised cursor is answered, never thrown and never an empty delta",
    async (context) => {
      const scope = caseScope(context);
      await seedWith(context, [
        foreignEvent(scope.calendar, {
          uid: markedWith("CONF-O40", "alpha"),
          start: "2026-03-02T09:00:00.000Z",
          end: "2026-03-02T10:00:00.000Z",
        }),
      ]);
      const minted = mintedBy("CONF-O40", context, listingOf("CONF-O40", await listChanges(context, scope)));
      if (minted === null) {
        return;
      }

      const tampered: SyncCursor = { ...minted, value: `${minted.value}-tampered` };
      const replayed = await listChanges(context, scope, tampered);

      insist(
        "CONF-O40",
        isLostOrRefused(replayed),
        "a cursor the adapter cannot read was answered as if it still meant something",
      );
    },
  ),
];

export { cursorCases, cursorOf, eventNamed, isLostOrRefused };
