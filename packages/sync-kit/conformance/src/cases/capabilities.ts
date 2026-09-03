import type {
  AllDayRepresentation,
  Capabilities,
  ChangeListing,
  EditableContent,
  EventTime,
  ProviderId,
  RepresentabilityConstraint,
  RepresentableRange,
  Result,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import type { ConformanceCase } from "../registry/case";
import { createIntent } from "./intents";
import {
  caseScope,
  contentOf,
  defineCase,
  failureKindOf,
  insist,
  listChanges,
  listingOf,
  markedWith,
  objectsMarked,
  seedWith,
  write,
} from "./support";

const refusedWith = (
  answered: Result<WriteOutcome>,
  constraint: RepresentabilityConstraint,
): boolean => {
  if (!answered.ok) {
    return answered.failure.kind === "unrepresentable" && answered.failure.constraint === constraint;
  }
  return (
    answered.value.kind === "unrepresentable" && answered.value.constraint === constraint
  );
};

const nativeRecurrence = (uid: string): EditableContent => ({
  title: uid,
  description: null,
  location: null,
  availability: "busy",
  visibility: "default",
  recurrence: { dialect: "providerNative", value: "EVERY_WEEKDAY", exceptions: [] },
  anchor: {
    kind: "timed",
    start: { kind: "instant", value: "2026-03-02T09:00:00.000Z" },
    zone: { kind: "zoneId", value: "UTC" },
    duration: { kind: "exact", seconds: 3600 },
  },
});

const zonedAs = (uid: string, zone: string): EditableContent => ({
  title: uid,
  description: null,
  location: null,
  availability: "busy",
  visibility: "default",
  recurrence: null,
  time: {
    kind: "timed",
    start: { kind: "instant", value: "2026-03-02T09:00:00.000Z" },
    end: { kind: "instant", value: "2026-03-02T10:00:00.000Z" },
    zone: { kind: "zoneId", value: zone },
  },
});

const seriesAnchoredIn = (uid: string, zone: string): EditableContent => ({
  title: uid,
  description: null,
  location: null,
  availability: "busy",
  visibility: "default",
  recurrence: { dialect: "rfc5545", value: "FREQ=WEEKLY;COUNT=2", exceptions: [] },
  anchor: {
    kind: "timed",
    start: { kind: "instant", value: "2026-03-02T09:00:00.000Z" },
    zone: { kind: "zoneId", value: zone },
    duration: { kind: "exact", seconds: 3600 },
  },
});

const allDayAs = (uid: string, representation: AllDayRepresentation): EditableContent => {
  const described = {
    title: uid,
    description: null,
    location: null,
    availability: "busy",
    visibility: "default",
    recurrence: null,
  } as const;
  if (representation === "dateOnly") {
    return {
      ...described,
      time: {
        kind: "allDay",
        startDate: { kind: "calendarDate", value: "2026-03-12" },
        endDateExclusive: { kind: "calendarDate", value: "2026-03-13" },
      },
    };
  }
  return {
    ...described,
    time: {
      kind: "timed",
      start: { kind: "instant", value: "2026-03-12T00:00:00.000Z" },
      end: { kind: "instant", value: "2026-03-13T00:00:00.000Z" },
      zone: { kind: "zoneId", value: "UTC" },
    },
  };
};

const gridHoldsFor = (time: EventTime | null, grid: RepresentableRange["allDayGrid"]): boolean => {
  if (time === null || time.kind === "allDay") {
    return true;
  }
  if (grid !== "utcDay") {
    return true;
  }
  return time.start.value.endsWith("T00:00:00.000Z") && time.end.value.endsWith("T00:00:00.000Z");
};

const carriesRetryAfter = (answered: Result<ChangeListing>): boolean => {
  if (answered.ok || answered.failure.kind !== "rateLimited") {
    return false;
  }
  return answered.failure.retryAfter !== null;
};

const undeclaredStatus = 599;

const acceptedByIntl = (zone: string): boolean => {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone.length > 0
    );
  } catch {
    return false;
  }
};

const capabilityCases = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
): readonly ConformanceCase<Provider>[] => [
  defineCase(
    supports,
    "CONF-O29",
    "a declared refusal actually refuses",
    async (context) => {
      const scope = caseScope(context);
      const key = markedWith("CONF-O29", "inverted");
      await seedWith(context, []);
      const answered = await write(
        context,
        createIntent(
          supports,
          scope.calendar,
          context.environment.installation,
          key,
          contentOf({
            uid: key,
            start: "2026-03-02T10:00:00.000Z",
            end: "2026-03-02T09:00:00.000Z",
          }),
        ),
      );
      const stored = await objectsMarked(context.provider, "CONF-O29");

      if (supports.representableRange.invertedRange === "reject") {
        insist(
          "CONF-O29",
          refusedWith(answered, "invertedRange"),
          "an adapter that declares it rejects inverted ranges accepted one",
        );
        insist(
          "CONF-O29",
          stored.length === 0,
          "a refused write still left an object on the calendar",
        );
        return;
      }
      insist(
        "CONF-O29",
        answered.ok,
        "an adapter that declares it clamps inverted ranges refused one instead",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O35",
    "an unsupported construct is withheld and counted, never approximated",
    async (context) => {
      const scope = caseScope(context);
      const key = markedWith("CONF-O35", "native");
      await seedWith(context, []);

      const answered = await write(
        context,
        createIntent(
          supports,
          scope.calendar,
          context.environment.installation,
          key,
          nativeRecurrence(key),
        ),
      );
      const stored = await objectsMarked(context.provider, "CONF-O35");

      if (supports.recurrenceWrite === "providerNative") {
        insist("CONF-O35", answered.ok, "an adapter that speaks its own dialect refused it");
        return;
      }
      insist(
        "CONF-O35",
        refusedWith(answered, "recurrenceDialect"),
        "a recurrence dialect the adapter cannot speak was approximated instead of refused",
      );
      insist(
        "CONF-O35",
        stored.length === 0,
        "an approximation of an unsupported recurrence was written anyway",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O43",
    "a non-IANA zone identifier never reaches a canonical event",
    async (context) => {
      const scope = caseScope(context);
      const refused = markedWith("CONF-O43", "windows");
      const accepted = markedWith("CONF-O43", "iana");
      await seedWith(context, []);

      const windows = await write(
        context,
        createIntent(
          supports,
          scope.calendar,
          context.environment.installation,
          refused,
          zonedAs(refused, "Pacific Standard Time"),
        ),
      );
      insist(
        "CONF-O43",
        refusedWith(windows, "zoneIdentifier"),
        "a Windows zone identifier was accepted as if it were an IANA zone",
      );

      await write(
        context,
        createIntent(
          supports,
          scope.calendar,
          context.environment.installation,
          accepted,
          zonedAs(accepted, "UTC"),
        ),
      );
      const listing = listingOf("CONF-O43", await listChanges(context, scope));
      const zones = (listing.events ?? []).flatMap((event) => {
        const { time } = event.content;
        if (!time || time.kind === "allDay" || time.zone === null) {
          return [];
        }
        return [time.zone.value];
      });
      insist(
        "CONF-O43",
        zones.every((zone) => acceptedByIntl(zone)),
        "a zone identifier no runtime can resolve reached a canonical event",
      );

      const series = markedWith("CONF-O43", "series");
      const recurring = await write(
        context,
        createIntent(
          supports,
          scope.calendar,
          context.environment.installation,
          series,
          seriesAnchoredIn(series, "Pacific Standard Time"),
        ),
      );
      insist(
        "CONF-O43",
        refusedWith(recurring, "zoneIdentifier"),
        "a Windows zone identifier anchoring a series was accepted where a single occurrence was refused",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O45",
    "an all-day event is never silently converted out of the representation it was written in",
    async (context) => {
      const scope = caseScope(context);
      const key = markedWith("CONF-O45", "allDay");
      await seedWith(context, []);
      const submitted = allDayAs(key, supports.allDay);

      const written = await write(
        context,
        createIntent(supports, scope.calendar, context.environment.installation, key, submitted),
      );
      const listing = listingOf("CONF-O45", await listChanges(context, scope));
      const mirrored = (listing.events ?? []).find((event) => event.uid.value === key);

      insist("CONF-O45", written.ok, "an all-day event in the declared representation was refused");
      insist("CONF-O45", Boolean(mirrored), "an all-day event we wrote did not come back");
      insist(
        "CONF-O45",
        mirrored?.content.time?.kind === submitted.time?.kind,
        "an all-day event came back in a representation the adapter never declared",
      );
      insist(
        "CONF-O45",
        gridHoldsFor(mirrored?.content.time ?? null, supports.representableRange.allDayGrid),
        "an all-day event came back off the day grid the adapter declared",
      );
    },
  ),

  defineCase(
    supports,
    "CONF-O46",
    "every throttle signal the adapter declares is classified as a throttle, and no other status is",
    async (context) => {
      const scope = caseScope(context);
      await seedWith(context, []);

      for (const signal of supports.throttleSignals) {
        context.environment.transport.answerWith({
          kind: "status",
          status: signal.status,
          retryAfter: { kind: "instant", value: "2099-01-01T00:00:00.000Z" },
          times: Number.MAX_SAFE_INTEGER,
        });
        const answered = await listChanges(context, scope, null, { maxAttempts: 1 });
        context.environment.transport.answerWith({ kind: "pass" });

        insist(
          "CONF-O46",
          failureKindOf(answered) === "rateLimited",
          `a declared throttle signal (${signal.status}) was classified as "${failureKindOf(answered)}"`,
        );
        insist(
          "CONF-O46",
          carriesRetryAfter(answered) === signal.hasRetryAfter,
          `a declared throttle signal (${signal.status}) disagreed with the retry-after it promised`,
        );
      }

      context.environment.transport.answerWith({
        kind: "status",
        status: undeclaredStatus,
        retryAfter: null,
        times: Number.MAX_SAFE_INTEGER,
      });
      const undeclared = await listChanges(context, scope, null, { maxAttempts: 1 });
      context.environment.transport.answerWith({ kind: "pass" });

      insist(
        "CONF-O46",
        failureKindOf(undeclared) !== "rateLimited",
        "a status the adapter never declared as a throttle signal was backed off as one anyway",
      );
    },
  ),
];

export {
  acceptedByIntl,
  allDayAs,
  capabilityCases,
  nativeRecurrence,
  refusedWith,
  seriesAnchoredIn,
  zonedAs,
};
