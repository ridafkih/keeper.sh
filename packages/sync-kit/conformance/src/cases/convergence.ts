import type {
  Capabilities,
  ChangeListing,
  EditableContent,
  ProviderId,
  RemoteEvent,
} from "@keeper.sh/sync-protocol";
import { canonicalise } from "../canonical";
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
  outcomeOf,
  seedWith,
  write,
  writeLogLength,
} from "./support";

const marked = (listing: ChangeListing, prefix: string): readonly RemoteEvent[] =>
  (listing.events ?? []).filter((event) => event.uid.value.startsWith(prefix));

const summaryOfMarked = (listing: ChangeListing, prefix: string): string =>
  canonicalise(
    marked(listing, prefix).map((event) => ({
      uid: event.uid.value,
      revision: event.revision,
      title: event.content.title,
    })),
  );

const trailingWhitespaceContent = (): EditableContent => ({
  title: "Design review \r\n",
  description: null,
  location: null,
  availability: "busy",
  visibility: "default",
  recurrence: null,
  time: {
    kind: "timed",
    start: { kind: "instant", value: "2026-03-02T09:00:00.000Z" },
    end: { kind: "instant", value: "2026-03-02T10:00:00.000Z" },
    zone: { kind: "zoneId", value: "UTC" },
  },
});

const straightOrder = (): EditableContent => ({
  title: "Permuted",
  description: null,
  location: null,
  availability: "busy",
  visibility: "default",
  recurrence: null,
  time: {
    kind: "timed",
    start: { kind: "instant", value: "2026-03-04T09:00:00.000Z" },
    end: { kind: "instant", value: "2026-03-04T10:00:00.000Z" },
    zone: { kind: "zoneId", value: "UTC" },
  },
});

const permutedOrder = (): EditableContent => ({
  visibility: "default",
  availability: "busy",
  location: null,
  description: null,
  title: "Permuted",
  recurrence: null,
  time: {
    kind: "timed",
    start: { kind: "instant", value: "2026-03-04T09:00:00.000Z" },
    end: { kind: "instant", value: "2026-03-04T10:00:00.000Z" },
    zone: { kind: "zoneId", value: "UTC" },
  },
});

const convergenceCases = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
): readonly ConformanceCase<Provider>[] => [
  defineCase(
    supports,
    "CONF-O8",
    "the same colliding pair produces the same winner in either feed order",
    async (context) => {
      const scope = caseScope(context);
      const uid = markedWith("CONF-O8", "collider");
      const older = foreignEvent(scope.calendar, {
        uid,
        title: "Older",
        start: "2026-03-02T09:00:00.000Z",
        end: "2026-03-02T10:00:00.000Z",
        revision: 1,
      });
      const newer = foreignEvent(scope.calendar, {
        uid,
        title: "Newer",
        start: "2026-03-02T11:00:00.000Z",
        end: "2026-03-02T12:00:00.000Z",
        revision: 2,
      });

      await seedWith(context, [older, newer]);
      const forward = listingOf("CONF-O8", await listChanges(context, scope));
      await seedWith(context, [newer, older]);
      const backward = listingOf("CONF-O8", await listChanges(context, scope));

      insist(
        "CONF-O8",
        summaryOfMarked(forward, "CONF-O8") === summaryOfMarked(backward, "CONF-O8"),
        "the winner between two revisions depended on the order the feed happened to deliver them",
      );
    },
  ),

  defineCase(supports, "CONF-O9", "re-running against unchanged input is zero writes", async (context) => {
    const scope = caseScope(context);
    await seedWith(context, [
      foreignEvent(scope.calendar, {
        uid: markedWith("CONF-O9", "quiet"),
        start: "2026-03-02T09:00:00.000Z",
        end: "2026-03-02T10:00:00.000Z",
      }),
    ]);

    const before = await writeLogLength(context.provider);
    await listChanges(context, scope);
    await listChanges(context, scope);
    const after = await writeLogLength(context.provider);

    insist("CONF-O9", after === before, "reading a calendar twice wrote to it");
  }),

  defineCase(
    supports,
    "CONF-O20",
    "a provider's own lossless rewrite does not read as drift",
    async (context) => {
      const scope = caseScope(context);
      const key = markedWith("CONF-O20", "rewritten");
      await seedWith(context, []);

      const created = outcomeOf(
        "CONF-O20",
        await write(
          context,
          createIntent(
            supports,
            scope.calendar,
            context.environment.installation,
            key,
            trailingWhitespaceContent(),
          ),
        ),
      );
      const replayed = outcomeOf(
        "CONF-O20",
        await write(
          context,
          createIntent(
            supports,
            scope.calendar,
            context.environment.installation,
            key,
            trailingWhitespaceContent(),
          ),
        ),
      );

      insist("CONF-O20", created.kind === "created", "the first write did not create anything");
      insist(
        "CONF-O20",
        replayed.kind === "alreadyExists" || replayed.kind === "unchanged",
        "the provider's own lossless rewrite of what we submitted read back as a change",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O21",
    "permuted key order is one identity, not two",
    async (context) => {
      const scope = caseScope(context);
      const key = markedWith("CONF-O21", "permuted");
      await seedWith(context, []);

      const straight = outcomeOf(
        "CONF-O21",
        await write(
          context,
          createIntent(
            supports,
            scope.calendar,
            context.environment.installation,
            key,
            straightOrder(),
          ),
        ),
      );
      const permuted = outcomeOf(
        "CONF-O21",
        await write(
          context,
          createIntent(
            supports,
            scope.calendar,
            context.environment.installation,
            key,
            permutedOrder(),
          ),
        ),
      );

      insist("CONF-O21", straight.kind === "created", "the first write did not create anything");
      insist(
        "CONF-O21",
        permuted.kind === "alreadyExists" || permuted.kind === "unchanged",
        "the same content spelled in a different key order read as a second identity",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O22",
    "one identity repeated in a listing is one entry, last observation wins",
    async (context) => {
      const scope = caseScope(context);
      const uid = markedWith("CONF-O22", "repeated");
      const older = foreignEvent(scope.calendar, {
        uid,
        title: "Older",
        start: "2026-03-02T09:00:00.000Z",
        end: "2026-03-02T10:00:00.000Z",
        revision: 1,
      });
      const newer = foreignEvent(scope.calendar, {
        uid,
        title: "Newer",
        start: "2026-03-02T11:00:00.000Z",
        end: "2026-03-02T12:00:00.000Z",
        revision: 2,
      });

      await seedWith(context, [older, newer, older]);
      const listing = listingOf("CONF-O22", await listChanges(context, scope));
      const collided = marked(listing, "CONF-O22");

      insist(
        "CONF-O22",
        collided.length === 1,
        "one identity reported several times in one listing became several entries",
      );
      insist(
        "CONF-O22",
        collided.at(0)?.revision === 2,
        "the winner between repeated observations was not the newest one",
      );
    },
  ),
];

export { convergenceCases, marked, summaryOfMarked };
