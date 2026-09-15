import { describe, expect, it } from "vitest";
import { DEFAULT_RULE, evaluateRules } from "@keeper.sh/data-schemas";
import type { RuleEventFacts, SyncRule } from "@keeper.sh/data-schemas";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import {
  createEditableEventContentSnapshot,
  createSyncEventContentHash,
  hashEditableEventContentSnapshot,
} from "../../../src/core/events/content-hash";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, RemoteEvent } from "../../../src/core/types";

const TEST_RECONCILIATION_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const facts: RuleEventFacts = {
  calendarName: "Source",
  description: "agenda for the sync",
  isAllDay: false,
  isFocusTime: false,
  isOutOfOffice: false,
  location: "Room 101",
  title: "Weekly sync",
};

const renamedRule: Pick<SyncRule, "actions" | "conditions"> = {
  actions: [{ kind: "rename", template: "OOO" }, { kind: "drop_description" }],
  conditions: [],
};

const localEventUnderRule = (rule: Pick<SyncRule, "actions" | "conditions">): MaterializedSyncableEvent => {
  const evaluation = evaluateRules([rule], facts);
  if (evaluation.skip) {
    throw new Error("rule skipped the fixture event");
  }
  return {
    calendarId: "source-calendar-id",
    calendarName: "Source",
    calendarUrl: null,
    description: evaluation.description,
    endTime: new Date("2026-03-08T15:00:00.000Z"),
    id: "event-state-id-1",
    isPrivate: evaluation.isPrivate,
    location: evaluation.location,
    sourceEventUid: "source-event-uid-1",
    startTime: new Date("2026-03-08T14:00:00.000Z"),
    summary: evaluation.summary,
  };
};

const computeAfterRuleChange = (
  alreadySynced: MaterializedSyncableEvent,
  localNow: MaterializedSyncableEvent,
) => {
  const mapping: EventMapping = {
    calendarId: "destination-calendar-id",
    deleteIdentifier: "delete-identifier-1",
    destinationEventUid: "destination-uid-1",
    endTime: alreadySynced.endTime,
    eventStateId: "event-state-id-1",
    id: "mapping-id-1",
    sourceCalendarId: "source-calendar-id",
    startTime: alreadySynced.startTime,
    syncEventHash: createSyncEventContentHash(alreadySynced),
    syncEventId: "event-state-id-1",
  };
  const mirroredContent = createEditableEventContentSnapshot(alreadySynced);
  const remoteEvent: RemoteEvent = {
    deleteId: mapping.deleteIdentifier,
    editableAvailability: "busy",
    editableContent: mirroredContent,
    editableContentHash: hashEditableEventContentSnapshot(mirroredContent),
    endTime: alreadySynced.endTime,
    isKeeperEvent: true,
    startTime: alreadySynced.startTime,
    uid: mapping.destinationEventUid,
  };

  return computeSyncOperations([localNow], [mapping], [remoteEvent], TEST_RECONCILIATION_SCOPE);
};

describe("changing the applied rule restales already synced events", () => {
  const underDefault = localEventUnderRule(DEFAULT_RULE);
  const underRename = localEventUnderRule(renamedRule);

  it("emits operations when a pair switches from the default rule to a rename", () => {
    expect(computeAfterRuleChange(underDefault, underRename).operations).not.toHaveLength(0);
  });

  it("emits operations when the pair switches back", () => {
    expect(computeAfterRuleChange(underRename, underDefault).operations).not.toHaveLength(0);
  });

  it("emits nothing while the rule stays the same", () => {
    expect(computeAfterRuleChange(underRename, underRename).operations).toHaveLength(0);
  });
});
