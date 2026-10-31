import type {
  CalendarKey,
  Capabilities,
  EditableContent,
  ProviderId,
  RemoteVersion,
  WriteIntent,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import {
  assertConflictNotOverwrite,
  assertNoUnconditionalWrite,
  assertNoUnplannedRecreation,
} from "../assertions/outcome";
import type { CaseContext, ConformanceCase } from "../registry/case";
import { createIntent, deleteIntent, updateIntent } from "./intents";
import {
  caseScope,
  contentOf,
  defineCase,
  foreignEvent,
  insist,
  listChanges,
  listingOf,
  markedWith,
  objectsMarked,
  outcomeOf,
  seedWith,
  uidsOf,
  write,
  writeLogLength,
  writeLogSince,
} from "./support";

const versionOf = (outcome: WriteOutcome): RemoteVersion => {
  if ("version" in outcome) {
    return outcome.version;
  }
  return { kind: "remoteVersion", value: "no-version" };
};

const remoteIdOf = (outcome: WriteOutcome): string => {
  if ("remote" in outcome) {
    return outcome.remote.id.value;
  }
  return "no-remote";
};

const echoKindOf = (outcome: WriteOutcome): string => {
  if ("echo" in outcome) {
    return outcome.echo.kind;
  }
  return "no-echo";
};

const meetingAt = (uid: string, hour: string): EditableContent =>
  contentOf({ uid, start: `2026-03-02T${hour}:00:00.000Z`, end: `2026-03-02T${hour}:30:00.000Z` });

const seriesAnchoredAt = (uid: string, hour: string): EditableContent => ({
  title: uid,
  description: null,
  location: null,
  availability: "busy",
  visibility: "default",
  recurrence: { dialect: "rfc5545", value: "FREQ=WEEKLY;COUNT=3", exceptions: [] },
  anchor: {
    kind: "timed",
    start: { kind: "instant", value: `2026-03-02T${hour}:00:00.000Z` },
    zone: { kind: "zoneId", value: "UTC" },
    duration: { kind: "exact", seconds: 1800 },
  },
});

const createFor = <Provider extends ProviderId>(
  context: CaseContext<Provider>,
  supports: Capabilities<Provider>,
  calendar: CalendarKey,
  key: string,
  hour: string,
): WriteIntent<Provider> =>
  createIntent(
    supports,
    calendar,
    context.environment.installation,
    key,
    meetingAt(key, hour),
  );

const writeCases = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
): readonly ConformanceCase<Provider>[] => [
  defineCase(
    supports,
    "CONF-O7",
    "an unbuildable newest revision withholds its identity instead of falling back",
    async (context) => {
      const scope = caseScope(context);
      const uid = markedWith("CONF-O7", "superseded");
      await seedWith(context, [
        foreignEvent(scope.calendar, {
          uid,
          start: "2026-03-02T09:00:00.000Z",
          end: "2026-03-02T10:00:00.000Z",
          revision: 1,
        }),
        foreignEvent(scope.calendar, {
          uid,
          start: "2026-03-02T12:00:00.000Z",
          end: "2026-03-02T11:00:00.000Z",
          revision: 2,
        }),
      ]);

      const listing = listingOf("CONF-O7", await listChanges(context, scope));
      insist(
        "CONF-O7",
        !uidsOf(listing).includes(uid),
        "an identity whose newest revision is unbuildable was published at its stale time",
      );
      insist(
        "CONF-O7",
        (listing.withheld ?? []).some((entry) => entry.uid?.value === uid),
        "an identity whose newest revision is unbuildable vanished instead of being withheld",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O14",
    "a replayed create with the same identity is a no-op, never a duplicate",
    async (context) => {
      const scope = caseScope(context);
      const key = markedWith("CONF-O14", "replayed");
      const intent = createIntent(
        supports,
        scope.calendar,
        context.environment.installation,
        key,
        meetingAt(key, "09"),
      );
      await seedWith(context, []);

      const first = outcomeOf("CONF-O14", await write(context, intent));
      const second = outcomeOf("CONF-O14", await write(context, intent));
      const objects = await objectsMarked(context.provider, "CONF-O14");

      insist("CONF-O14", first.kind === "created", "the first create did not create anything");
      insist(
        "CONF-O14",
        second.kind === "alreadyExists" || second.kind === "unchanged",
        "a replayed create was treated as a fresh write",
      );
      insist(
        "CONF-O14",
        remoteIdOf(second) === remoteIdOf(first),
        "a replayed create answered with a different remote reference",
      );
      insist("CONF-O14", objects.length === 1, "a replayed create left two objects behind");
    },
  ),

  defineCase(
    supports,
    "CONF-O15",
    "a conflicting create is a typed refusal, never a blind recreation",
    async (context) => {
      const scope = caseScope(context);
      const key = markedWith("CONF-O15", "contended");
      await seedWith(context, []);
      const before = await writeLogLength(context.provider);
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

      const answered = await write(
        context,
        createIntent(
          supports,
          scope.calendar,
          context.environment.installation,
          key,
          meetingAt(key, "11"),
        ),
      );
      assertNoUnplannedRecreation(await writeLogSince(context.provider, before), []);

      if (!answered.ok) {
        insist(
          "CONF-O15",
          answered.failure.kind === "conflict",
          `a differing remote copy answered "${answered.failure.kind}" instead of a conflict`,
        );
        return;
      }
      insist(
        "CONF-O15",
        answered.value.kind === "conflict",
        `a differing remote copy answered "${answered.value.kind}" instead of a conflict`,
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O18",
    "an adapter that cannot observe its own write says so",
    async (context) => {
      const scope = caseScope(context);
      const key = markedWith("CONF-O18", "echoed");
      await seedWith(context, []);

      const created = outcomeOf(
        "CONF-O18",
        await write(
          context,
          createIntent(
            supports,
            scope.calendar,
            context.environment.installation,
            key,
            meetingAt(key, "09"),
          ),
        ),
      );

      insist("CONF-O18", echoKindOf(created) !== "no-echo", "a create reported no echo verdict");
      if (supports.echoesWrites) {
        insist(
          "CONF-O18",
          echoKindOf(created) !== "notObserved",
          "an adapter that declares it echoes writes reported the echo as unobserved",
        );
        return;
      }
      insist(
        "CONF-O18",
        echoKindOf(created) === "notObserved",
        "an adapter that cannot observe its writes claimed the echo matched",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O25",
    "a replace whose second half fails leaves a recoverable state",
    async (context) => {
      const scope = caseScope(context);
      const replaced = markedWith("CONF-O25", "replaced");
      const blocker = markedWith("CONF-O25", "blocker");
      await seedWith(context, []);
      const blocking = outcomeOf(
        "CONF-O25",
        await write(context, createFor(context, supports, scope.calendar, blocker, "07")),
      );
      const original = outcomeOf(
        "CONF-O25",
        await write(context, createFor(context, supports, scope.calendar, replaced, "09")),
      );
      const before = await writeLogLength(context.provider);
      const removed = `handle-${replaced}`;

      const deleted = await write(
        context,
        deleteIntent(scope.calendar, removed, versionOf(original)),
      );
      const recreated = await write(
        context,
        createFor(context, supports, scope.calendar, blocker, "11"),
      );
      const logged = await writeLogSince(context.provider, before);
      const survivors = await objectsMarked(context.provider, "CONF-O25");
      assertConflictNotOverwrite(recreated);
      assertNoUnplannedRecreation(logged, [removed]);

      insist(
        "CONF-O25",
        deleted.ok && deleted.value.kind === "deleted",
        "the first half of the replace did not remove the copy it was pointed at",
      );
      insist(
        "CONF-O25",
        logged.some((entry) => entry.intent.kind === "delete" && entry.intent.target.value === removed),
        "the write log no longer names the target the failed replace had already deleted",
      );
      insist(
        "CONF-O25",
        survivors.some(
          (event) =>
            event.uid.value === blocker && event.version.value === versionOf(blocking).value,
        ),
        "the copy that blocked the second half was destroyed by the half that failed",
      );

      const retried = await write(
        context,
        createFor(context, supports, scope.calendar, replaced, "11"),
      );
      insist(
        "CONF-O25",
        retried.ok && retried.value.kind === "created",
        "the state after a half-completed replace could not be recovered on the next run",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O36",
    "moving an occurrence is one conditional write against a target that is still ours",
    async (context) => {
      const scope = caseScope(context);
      const key = markedWith("CONF-O36", "occurrence");
      await seedWith(context, []);
      const created = outcomeOf(
        "CONF-O36",
        await write(
          context,
          createIntent(
            supports,
            scope.calendar,
            context.environment.installation,
            key,
            seriesAnchoredAt(key, "09"),
          ),
        ),
      );
      const listed = listingOf("CONF-O36", await listChanges(context, scope));
      const mirrored = (listed.events ?? []).find((event) => event.uid.value === key);
      const before = await writeLogLength(context.provider);
      insist("CONF-O36", Boolean(mirrored), "the series we wrote did not come back through the adapter");
      if (!mirrored) {
        return;
      }
      if (supports.provenanceChannel !== "none") {
        insist(
          "CONF-O36",
          mirrored.provenance.kind === "ours",
          "an occurrence was reassigned against a target the adapter could not prove was ours",
        );
      }

      await write(
        context,
        updateIntent(
          supports,
          scope.calendar,
          `id-${key}`,
          seriesAnchoredAt(key, "11"),
          versionOf(created),
        ),
      );
      const logged = await writeLogSince(context.provider, before);
      const moved = listingOf("CONF-O36", await listChanges(context, scope));
      const reassigned = (moved.events ?? []).find((event) => event.uid.value === key);
      assertNoUnconditionalWrite(logged);

      insist(
        "CONF-O36",
        logged.every((entry) => entry.intent.kind !== "delete"),
        "moving an occurrence was expressed as a delete followed by an add",
      );
      insist(
        "CONF-O36",
        logged.filter((entry) => entry.intent.kind === "update").length === 1,
        "moving one occurrence took more than the single conditional write it needs",
      );
      insist(
        "CONF-O36",
        reassigned?.fingerprint.value !== mirrored.fingerprint.value,
        "a series moved to a new anchor kept the fingerprint of the anchor it left",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O44",
    "two writers holding the same precondition cannot both win",
    async (context) => {
      const scope = caseScope(context);
      const key = markedWith("CONF-O44", "contended");
      await seedWith(context, []);
      const created = outcomeOf(
        "CONF-O44",
        await write(context, createFor(context, supports, scope.calendar, key, "09")),
      );
      const held = versionOf(created);

      const [earlier, later] = await Promise.all([
        write(context, updateIntent(supports, scope.calendar, `id-${key}`, meetingAt(key, "11"), held)),
        write(context, updateIntent(supports, scope.calendar, `id-${key}`, meetingAt(key, "13"), held)),
      ]);
      const stored = await objectsMarked(context.provider, "CONF-O44");
      const answers = [earlier, later];
      const winners = answers.filter((answered) => answered.ok && answered.value.kind === "updated");
      const losers = answers.filter((answered) => !winners.includes(answered));

      insist(
        "CONF-O44",
        winners.length === 1,
        `${winners.length} of two writers holding the same precondition were told they had won`,
      );
      insist(
        "CONF-O44",
        stored.length === 1 && stored.at(0)?.revision === 2,
        "two concurrent writers left the calendar holding something other than one applied write",
      );
      for (const answered of losers) {
        assertConflictNotOverwrite(answered);
      }
    },
  ),

  defineCase(
    supports,
    "CONF-O39",
    "a stale precondition is a typed conflict, never a silent overwrite",
    async (context) => {
      const scope = caseScope(context);
      const key = markedWith("CONF-O39", "contended");
      await seedWith(context, []);
      const created = outcomeOf(
        "CONF-O39",
        await write(
          context,
          createIntent(
            supports,
            scope.calendar,
            context.environment.installation,
            key,
            meetingAt(key, "09"),
          ),
        ),
      );
      const stale = versionOf(created);

      await write(
        context,
        updateIntent(supports, scope.calendar, `id-${key}`, meetingAt(key, "11"), stale),
      );
      const replayed = await write(
        context,
        updateIntent(supports, scope.calendar, `id-${key}`, meetingAt(key, "13"), stale),
      );

      insist(
        "CONF-O39",
        !replayed.ok && replayed.failure.kind === "conflict",
        "a write whose precondition was already spent was accepted a second time",
      );
    },
  ),
];

export { echoKindOf, meetingAt, remoteIdOf, seriesAnchoredAt, versionOf, writeCases };
