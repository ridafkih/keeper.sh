import { describe, expect, it } from "vitest";
import type { CompleteRule } from "../../../src/features/setup/setup-draft";
import {
  buildDestinationPuts,
  buildSourcePatches,
  countNewMappings,
  exceedsMappingLimit,
} from "../../../src/features/setup/setup-commit";

const rule = (id: string, fromId: string, toIds: string | string[], detail: CompleteRule["detail"] = "calendar_name"): CompleteRule =>
  ({ detail, fromId, id, toIds: Array.isArray(toIds) ? toIds : [toIds] });

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

  it("replaces a source's destinations when the rule was opened for editing", () => {
    const edited = { ...rule("a", "work", ["family"]), loadedDetail: "calendar_name" as const, replace: true };
    expect(buildDestinationPuts([edited], { work: ["personal", "feed"] })).toEqual([
      { calendarIds: ["family"], sourceId: "work" },
    ]);
    expect(buildDestinationPuts([{ ...edited, toIds: ["feed", "personal"] }], { work: ["personal", "feed"] })).toEqual([]);
  });
});

describe("buildSourcePatches", () => {
  it("emits one patch per source and omits the default", () => {
    const patches = buildSourcePatches([
      rule("a", "work", "personal", "busy"),
      rule("b", "work", "feed", "busy"),
      rule("c", "personal", "work"),
      rule("d", "feed", "work", "titles"),
    ]);
    expect(patches).toEqual([
      { body: { customEventName: "Busy", excludeEventName: true }, sourceId: "work" },
      { body: { customEventName: "{{event_name}}", excludeEventName: false }, sourceId: "feed" },
    ]);
  });

  it("only patches an edited rule when its title choice changed", () => {
    const unchanged = { ...rule("a", "work", "personal", "busy"), loadedDetail: "busy" as const, replace: true };
    const reset = { ...rule("b", "feed", "work"), loadedDetail: "busy" as const, replace: true };
    expect(buildSourcePatches([unchanged, reset])).toEqual([
      { body: { customEventName: "{{calendar_name}}", excludeEventName: true }, sourceId: "feed" },
    ]);
  });
});

describe("mapping counts", () => {
  it("counts only the ids that are new, and removals as negative", () => {
    const puts = buildDestinationPuts([rule("a", "work", "personal")], { work: ["feed"] });
    expect(countNewMappings(puts, { work: ["feed"] })).toBe(1);
    const edited = { ...rule("b", "work", "personal"), loadedDetail: "calendar_name" as const, replace: true };
    const replaced = buildDestinationPuts([edited], { work: ["feed", "archive"] });
    expect(countNewMappings(replaced, { work: ["feed", "archive"] })).toBe(-1);
  });

  it("treats a null limit as unlimited", () => {
    expect(exceedsMappingLimit(10, null)).toBe(false);
    expect(exceedsMappingLimit(4, 3)).toBe(true);
    expect(exceedsMappingLimit(3, 3)).toBe(false);
  });
});
