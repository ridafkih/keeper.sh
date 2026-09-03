import type { EventTime, RemoteEvent, WriteIntent } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type {
  KnownState,
  Mapping,
  MappingSet,
  ObservedState,
  Plan,
  PlannedWrite,
  ReconciliationPolicy,
  SourceIdentity,
  Tombstone,
} from "../../src/index";
import { deleteHandle, mirrorPrint, remoteId, sourcePrint, version } from "./fixtures";
import { expectedObservedIdentity, expectedSourceIdentityKey } from "./keys";

interface Scenario {
  readonly observed: ObservedState;
  readonly known: KnownState;
  readonly mappings: MappingSet;
  readonly policy: ReconciliationPolicy;
}

const observedEvents = (observed: ObservedState): readonly RemoteEvent[] => {
  const listing = observed.source;
  if (listing.kind === "cursorLost") {
    return [];
  }
  return listing.events ?? [];
};

const sourceEventFor = (
  observed: ObservedState,
  identity: SourceIdentity,
): RemoteEvent | undefined =>
  observedEvents(observed).find(
    (event) =>
      expectedSourceIdentityKey(expectedObservedIdentity(event)) ===
      expectedSourceIdentityKey(identity),
  );

const anchorAsTime = (event: RemoteEvent): EventTime => {
  const { anchor } = event.content;
  if (!anchor || anchor.kind === "allDay") {
    return { kind: "allDay", startDate: { kind: "calendarDate", value: "2026-03-10" }, endDateExclusive: { kind: "calendarDate", value: "2026-03-11" } };
  }
  return { kind: "timed", start: anchor.start, end: anchor.start, zone: anchor.zone };
};

const retiringCauses = ["absentFromSnapshot", "explicitRemoval", "destinationDisconnected"] as const;

const retiresTheSourceRow = (tombstone: Tombstone): boolean =>
  retiringCauses.some((cause) => cause === tombstone.cause);

const tombstonedKeys = (tombstones: readonly Tombstone[]): ReadonlySet<string> =>
  new Set(tombstones.map((tombstone) => expectedSourceIdentityKey(tombstone.identity)));

const mappingAfterCreate = (
  previous: Mapping | null,
  write: Extract<WriteIntent, { kind: "create" }>,
  scenario: Scenario,
  identity: SourceIdentity,
): Mapping => {
  const source = sourceEventFor(scenario.observed, identity);
  const created = remoteId(`created-${expectedSourceIdentityKey(identity)}`);
  return {
    sourceIdentity: identity,
    sourceCalendar: scenario.known.calendar,
    destination: previous?.destination ?? {
      id: created,
      deleteHandle: deleteHandle(created.value),
    },
    destinationCalendar: write.calendar.key,
    sourceFingerprint: sourcePrint(source?.fingerprint.value ?? "fp-unobserved"),
    mirrorFingerprint: mirrorPrint(write.content.fingerprint.value),
    precondition: { kind: "matchesVersion", version: version(`${created.value}-1`) },
  };
};

const mappingAfterUpdate = (previous: Mapping, write: Extract<WriteIntent, { kind: "update" }>, scenario: Scenario): Mapping => {
  const source = sourceEventFor(scenario.observed, previous.sourceIdentity);
  return {
    ...previous,
    sourceFingerprint: sourcePrint(source?.fingerprint.value ?? previous.sourceFingerprint.value.value),
    mirrorFingerprint: mirrorPrint(write.content.fingerprint.value),
    precondition: { kind: "matchesVersion", version: version(`${previous.destination.id.value}-next`) },
  };
};

const applySingleWrite = (
  entries: readonly Mapping[],
  write: Extract<PlannedWrite, { kind: "single" }>,
  scenario: Scenario,
): readonly Mapping[] => {
  const key = expectedSourceIdentityKey(write.identity);
  const previous =
    entries.find((entry) => expectedSourceIdentityKey(entry.sourceIdentity) === key) ?? null;
  const others = entries.filter((entry) => expectedSourceIdentityKey(entry.sourceIdentity) !== key);
  switch (write.intent.kind) {
    case "create": {
      return [...others, mappingAfterCreate(previous, write.intent, scenario, write.identity)];
    }
    case "update": {
      if (!previous) {
        return entries;
      }
      return [...others, mappingAfterUpdate(previous, write.intent, scenario)];
    }
    case "delete":
    case "retire": {
      return others;
    }
    default: {
      return assertNever(write.intent);
    }
  }
};

const applyWrite = (
  entries: readonly Mapping[],
  write: PlannedWrite,
  scenario: Scenario,
): readonly Mapping[] => {
  switch (write.kind) {
    case "single": {
      return applySingleWrite(entries, write, scenario);
    }
    case "replace": {
      const key = expectedSourceIdentityKey(write.identity);
      const others = entries.filter(
        (entry) => expectedSourceIdentityKey(entry.sourceIdentity) !== key,
      );
      return [...others, mappingAfterCreate(null, write.recreate, scenario, write.identity)];
    }
    default: {
      return assertNever(write);
    }
  }
};

const mappingsAfter = (scenario: Scenario, plan: Plan): MappingSet => {
  const retired = tombstonedKeys(plan.tombstones);
  const survivors = scenario.mappings.entries.filter(
    (entry) => !retired.has(expectedSourceIdentityKey(entry.sourceIdentity)),
  );
  let written: readonly Mapping[] = survivors;
  for (const write of plan.writes) {
    written = applyWrite(written, write, scenario);
  }
  return { entries: written };
};

const knownAfter = (scenario: Scenario, plan: Plan): KnownState => {
  const dropped = tombstonedKeys(plan.tombstones.filter(retiresTheSourceRow));
  const surviving = scenario.known.events.filter(
    (event) => !dropped.has(expectedSourceIdentityKey(event.identity)),
  );
  const observedRows = observedEvents(scenario.observed).map((event) => ({
    identity: expectedObservedIdentity(event),
    remoteId: event.id,
    sourceFingerprint: sourcePrint(event.fingerprint.value),
    revision: event.revision,
    time: event.content.time ?? anchorAsTime(event),
    recurring: Boolean(event.content.recurrence),
    sourceCalendar: scenario.known.calendar,
  }));
  const observedKeys = new Set(
    observedRows.map((row) => expectedSourceIdentityKey(row.identity)),
  );
  const untouched = surviving.filter(
    (event) => !observedKeys.has(expectedSourceIdentityKey(event.identity)),
  );
  return { ...scenario.known, events: [...untouched, ...observedRows] };
};

const applyPlan = (scenario: Scenario, plan: Plan): Scenario => ({
  ...scenario,
  known: knownAfter(scenario, plan),
  mappings: mappingsAfter(scenario, plan),
});

export { applyPlan, observedEvents };
export type { Scenario };
