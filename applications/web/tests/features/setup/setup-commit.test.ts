import { describe, expect, it } from "vitest";
import type { CompleteRule } from "../../../src/features/setup/setup-draft";
import {
  buildDestinationPuts,
  buildPairRulePuts,
  countNewMappings,
  exceedsMappingLimit,
} from "../../../src/features/setup/setup-commit";

const rule = (id: string, fromId: string, toIds: string | string[], syncRuleId: string | null = null): CompleteRule =>
  ({ fromId, id, syncRuleId, toIds: Array.isArray(toIds) ? toIds : [toIds] });

describe("buildDestinationPuts", () => {
  it("merges with existing destinations without dropping or duplicating", () => {
    const puts = buildDestinationPuts(
      [rule("a", "work", ["personal", "feed"]), rule("b", "work", "feed"), rule("c", "personal", "work")],
      { work: ["feed", "archive"] },
    );
    expect(puts).toEqual([
      { calendarIds: ["feed", "archive", "personal"], sourceId: "work" },
      { calendarIds: ["work"], sourceId: "personal" },
    ]);
  });

  it("skips a source whose mappings already exist", () => {
    expect(buildDestinationPuts([rule("a", "work", "personal")], { work: ["personal"] })).toEqual([]);
  });
});

describe("buildPairRulePuts", () => {
  it("writes only the pairs where a rule was chosen, first sentence wins", () => {
    expect(buildPairRulePuts([
      rule("a", "work", ["personal", "feed"], "rule-ooo"),
      rule("b", "work", "personal", "rule-other"),
      rule("c", "personal", "work"),
    ])).toEqual([
      { destinationId: "personal", ruleIds: ["rule-ooo"], sourceId: "work" },
      { destinationId: "feed", ruleIds: ["rule-ooo"], sourceId: "work" },
    ]);
  });
});

describe("mapping counts", () => {
  it("counts only the ids that are new", () => {
    const puts = buildDestinationPuts([rule("a", "work", "personal")], { work: ["feed"] });
    expect(countNewMappings(puts, { work: ["feed"] })).toBe(1);
  });

  it("treats a null limit as unlimited", () => {
    expect(exceedsMappingLimit(10, null)).toBe(false);
    expect(exceedsMappingLimit(4, 3)).toBe(true);
    expect(exceedsMappingLimit(3, 3)).toBe(false);
  });
});
