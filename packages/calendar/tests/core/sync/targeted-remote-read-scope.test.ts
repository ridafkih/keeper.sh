import { describe, expect, it } from "vitest";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import type { ReconciliationScope } from "../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type { EventMapping } from "../../../src/core/events/mappings";
import type {
  MaterializedSyncableEvent,
  RemoteEvent,
} from "../../../src/core/types";

const WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

interface MirrorFixture {
  event: MaterializedSyncableEvent;
  mapping: EventMapping;
  remoteEvent: RemoteEvent;
}

const createMirror = (index: number): MirrorFixture => {
  const startTime = new Date(Date.UTC(2026, 2, 8, 9 + index, 0, 0));
  const endTime = new Date(Date.UTC(2026, 2, 8, 10 + index, 0, 0));
  const event: MaterializedSyncableEvent = {
    calendarId: "source-calendar-id",
    calendarName: "Source",
    calendarUrl: null,
    endTime,
    id: `event-state-id-${index}`,
    sourceEventUid: `source-event-uid-${index}`,
    startTime,
    summary: `Meeting ${index}`,
  };
  const mapping: EventMapping = {
    calendarId: "destination-calendar-id",
    deleteIdentifier: `delete-identifier-${index}`,
    destinationEventUid: `destination-uid-${index}`,
    endTime,
    eventStateId: `event-state-id-${index}`,
    id: `mapping-id-${index}`,
    sourceCalendarId: "source-calendar-id",
    startTime,
    syncEventHash: createSyncEventContentHash(event),
    syncEventId: `event-state-id-${index}`,
  };
  const remoteEvent: RemoteEvent = {
    deleteId: mapping.deleteIdentifier,
    endTime,
    isKeeperEvent: true,
    startTime,
    uid: mapping.destinationEventUid,
  };
  return { event, mapping, remoteEvent };
};

/*
 * A targeted push read fetches only the destination events the plan is about to
 * touch. Handed to the engine as though it were a full listing, every unfetched
 * mapping reads as remoteMissing and the whole mirrored calendar is deleted, so
 * these tests pin the blast radius of a partial read to the ids it covered.
 */
describe("partial remote reads", () => {
  it("strands no mapping outside the ids the read covered", () => {
    const covered = createMirror(2);
    const mirrors = [createMirror(1), covered, createMirror(3)];
    const scope: ReconciliationScope & {
      authoritativeMappingIds: ReadonlySet<string>;
    } = {
      authoritativeMappingIds: new Set([covered.mapping.id]),
      authoritativeWindow: WINDOW,
      requestedWindow: WINDOW,
    };

    const { operations, staleMappingIds, staleReasonCounts } = computeSyncOperations(
      mirrors.map(({ event }) => event),
      mirrors.map(({ mapping }) => mapping),
      [covered.remoteEvent],
      scope,
    );

    expect(staleMappingIds).toEqual([]);
    expect(staleReasonCounts.remoteMissing).toBe(0);
    expect(operations).toEqual([]);
  });

  it("still reports a covered mapping whose destination event is genuinely gone", () => {
    const covered = createMirror(2);
    const mirrors = [createMirror(1), covered, createMirror(3)];
    const scope: ReconciliationScope & {
      authoritativeMappingIds: ReadonlySet<string>;
    } = {
      authoritativeMappingIds: new Set([covered.mapping.id]),
      authoritativeWindow: WINDOW,
      requestedWindow: WINDOW,
    };

    const { operations, staleMappingIds, staleReasonCounts } = computeSyncOperations(
      mirrors.map(({ event }) => event),
      mirrors.map(({ mapping }) => mapping),
      [],
      scope,
    );

    expect(staleMappingIds).toEqual([covered.mapping.id]);
    expect(staleReasonCounts.remoteMissing).toBe(1);
    expect(operations).toEqual([
      {
        deleteId: covered.mapping.deleteIdentifier,
        event: covered.event,
        remoteMissing: true,
        staleMappingId: covered.mapping.id,
        type: "replace",
        uid: covered.mapping.destinationEventUid,
      },
    ]);
  });

  it("leaves a full windowed listing reporting every missing mapping as before", () => {
    const mirrors = [createMirror(1), createMirror(2), createMirror(3)];
    const scope: ReconciliationScope = {
      authoritativeWindow: WINDOW,
      requestedWindow: WINDOW,
    };

    const { staleMappingIds, staleReasonCounts } = computeSyncOperations(
      mirrors.map(({ event }) => event),
      mirrors.map(({ mapping }) => mapping),
      [],
      scope,
    );

    expect(staleMappingIds).toEqual(mirrors.map(({ mapping }) => mapping.id));
    expect(staleReasonCounts.remoteMissing).toBe(3);
  });
});
