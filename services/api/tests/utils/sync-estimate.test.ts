import { describe, expect, it } from "vitest";
import type { SyncDefinition, SyncRange } from "@keeper.sh/data-schemas";
import { estimateSyncCopies } from "../../src/utils/sync-estimate";
import type { EstimateCalendar, SyncEstimateDependencies } from "../../src/utils/sync-estimate";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const DAY = 86_400_000;

const definition = (overrides: Partial<SyncDefinition>): SyncDefinition => ({
  busyTitle: null,
  destinationCalendarIds: [],
  markPrivate: false,
  memberCalendarIds: [],
  mode: "one_way",
  name: "",
  paused: false,
  rules: [],
  shareAs: "busy_only",
  skipAllDay: false,
  skipFocusTime: false,
  skipOutOfOffice: false,
  skipTitleKeywords: [],
  sourceCalendarIds: [],
  ...overrides,
});

const calendar = (id: string, historic: SyncRange = "1_month", future: SyncRange = "2_years"): EstimateCalendar => ({
  id,
  syncFutureRange: future,
  syncHistoricRange: historic,
});

const inDays = (days: number): Date => new Date(NOW.getTime() + days * DAY);

const makeDependencies = (startsBySource: Record<string, Date[]>) => {
  const calls: { sourceIds: string[]; window: { timeMax: Date; timeMin: Date } }[] = [];
  const dependencies: SyncEstimateDependencies = {
    countCopies: (sourceIds, window) => {
      calls.push({ sourceIds, window });
      return Promise.resolve(sourceIds.flatMap((id) => startsBySource[id] ?? []));
    },
    resolveWindow: (historic, future) => ({
      timeMax: inDays(future === "2_years" ? 730 : 30),
      timeMin: inDays(historic === "1_month" ? -30 : -7),
    }),
  };
  return { calls, dependencies };
};

describe("estimateSyncCopies", () => {
  it("counts copies into each calendar of a both-ways sync, and the ones in the next four weeks", async () => {
    const { calls, dependencies } = makeDependencies({
      personal: [inDays(-3), inDays(2), inDays(40)],
      work: [inDays(1), inDays(27), inDays(29), inDays(300)],
    });
    const estimate = await estimateSyncCopies(
      definition({ memberCalendarIds: ["work", "personal"], mode: "both_ways" }),
      new Map([["work", calendar("work")], ["personal", calendar("personal")]]),
      dependencies,
      NOW,
    );

    expect(calls.map(({ sourceIds }) => sourceIds)).toEqual([["personal"], ["work"]]);
    expect(estimate).toEqual({
      nearTerm: { count: 3, days: 28 },
      total: { count: 7, futureRange: "2_years", historicRange: "1_month" },
    });
  });

  it("uses each destination's own window and reports no shared range when they differ", async () => {
    const { calls, dependencies } = makeDependencies({ work: [inDays(1)] });
    const estimate = await estimateSyncCopies(
      definition({ destinationCalendarIds: ["personal", "family"], sourceCalendarIds: ["work"] }),
      new Map([
        ["work", calendar("work")],
        ["personal", calendar("personal")],
        ["family", calendar("family", "1_week", "1_month")],
      ]),
      dependencies,
      NOW,
    );

    expect(calls[1]?.window).toEqual({ timeMax: inDays(30), timeMin: inDays(-7) });
    expect(estimate.total).toEqual({ count: 2, futureRange: null, historicRange: null });
  });

  it("passes the sync's own rules, so skipped events never count", async () => {
    let ruleIds: string[] = [];
    const estimate = await estimateSyncCopies(
      definition({ destinationCalendarIds: ["personal"], skipAllDay: true, sourceCalendarIds: ["work"] }),
      new Map([["work", calendar("work")], ["personal", calendar("personal")]]),
      {
        countCopies: (_sourceIds, _window, rules) => {
          ruleIds = rules.map((rule) => rule.id);
          return Promise.resolve([]);
        },
        resolveWindow: () => ({ timeMax: inDays(1), timeMin: inDays(-1) }),
      },
      NOW,
    );

    expect(ruleIds).toContain("skip:all_day");
    expect(estimate.total.count).toBe(0);
  });
});
