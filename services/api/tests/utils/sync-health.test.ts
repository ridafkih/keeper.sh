import { describe, expect, it } from "vitest";
import { DEFAULT_SYNC_SETTINGS } from "@keeper.sh/data-schemas";
import type { SyncDefinition } from "@keeper.sh/data-schemas";
import { buildSyncDetail } from "@/utils/syncs";
import type { PairStatusRow, SourceHealthRow } from "@/utils/syncs";

const SYNC_ID = "0d6f1a52-3b8e-4c2a-9f71-5e4d3c2b1a01";
const CREATED_AT = new Date("2026-10-01T00:00:00.000Z");

const row = {
  ...DEFAULT_SYNC_SETTINGS,
  createdAt: CREATED_AT,
  id: SYNC_ID,
  mode: "one_way",
  name: "Work Blocks Personal",
  paused: false,
  updatedAt: CREATED_AT,
  userId: "user-1",
};

const definition: SyncDefinition = {
  ...DEFAULT_SYNC_SETTINGS,
  destinationCalendarIds: ["personal", "family"],
  memberCalendarIds: [],
  mode: "one_way",
  name: "Work Blocks Personal",
  paused: false,
  sourceCalendarIds: ["work"],
};

const pair = (destinationCalendarId: string, overrides: Partial<PairStatusRow> = {}): PairStatusRow => ({
  copiedCount: 1,
  destinationCalendarId,
  disabled: false,
  failureCount: 0,
  lastErrorAt: null,
  lastSyncedAt: CREATED_AT,
  needsReauthentication: false,
  skippedCount: 0,
  syncId: SYNC_ID,
  ...overrides,
});

const healthy = (calendarId: string, overrides: Partial<SourceHealthRow> = {}): [string, SourceHealthRow] => [
  calendarId,
  { calendarId, disabled: false, ingestFailureCount: 0, needsReauthentication: false, ...overrides },
];

const build = (pairs: PairStatusRow[], sources: [string, SourceHealthRow][]) =>
  buildSyncDetail(row, definition, pairs, new Map(sources));

describe("buildSyncDetail", () => {
  it("is ok when every calendar is healthy", () => {
    const detail = build([pair("personal"), pair("family")], [healthy("work")]);
    expect(detail.state).toBe("ok");
    expect(detail.sources).toEqual([{ calendarId: "work", problem: null }]);
  });

  it("flags a source whose account needs reconnecting, or whose ingest is failing", () => {
    const reauth = build([pair("personal")], [healthy("work", { needsReauthentication: true })]);
    const failing = build([pair("personal")], [healthy("work", { ingestFailureCount: 2 })]);

    expect(reauth.sources).toEqual([{ calendarId: "work", problem: "reauth" }]);
    expect(reauth.state).toBe("problem");
    expect(failing.sources).toEqual([{ calendarId: "work", problem: "failing" }]);
    expect(failing.state).toBe("problem");
  });

  it("reports a paused calendar without calling the sync a problem", () => {
    const pausedSource = build([pair("personal")], [healthy("work", { disabled: true })]);
    const pausedDestination = build([pair("personal", { disabled: true })], [healthy("work")]);

    expect(pausedSource.sources).toEqual([{ calendarId: "work", problem: "disabled" }]);
    expect(pausedSource.state).toBe("ok");
    expect(pausedDestination.destinations[0]?.problem).toBe("disabled");
    expect(pausedDestination.state).toBe("ok");
  });

  it("marks a destination failing when any of its pairs last errored", () => {
    const detail = build(
      [pair("personal"), pair("family"), pair("family", { lastErrorAt: CREATED_AT })],
      [healthy("work")],
    );

    expect(detail.destinations.map((destination) => [destination.calendarId, destination.problem])).toEqual([
      ["personal", null],
      ["family", "failing"],
    ]);
    expect(detail.state).toBe("problem");
  });

  it("reads every member of a both-ways sync as a source", () => {
    const detail = buildSyncDetail(
      { ...row, mode: "both_ways" },
      { ...definition, destinationCalendarIds: [], memberCalendarIds: ["work", "personal"], mode: "both_ways", sourceCalendarIds: [] },
      [pair("personal"), pair("work")],
      new Map([healthy("work"), healthy("personal", { needsReauthentication: true })]),
    );

    expect(detail.sources).toEqual([
      { calendarId: "work", problem: null },
      { calendarId: "personal", problem: "reauth" },
    ]);
  });
});
