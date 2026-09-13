import { describe, expect, it } from "vitest";
import {
  addReverseRule,
  addRule,
  canReverse,
  createEmptyDraft,
  markPending,
  pruneStaleIds,
  removeRulesFrom,
  resolveConnectedAccount,
  resolveNewAccountDraft,
  setBlank,
  setRuleDetail,
  type SetupDraft,
} from "../../../src/features/setup/setup-draft";
import { makeSource } from "./fixtures";

const work = makeSource("work", "google-account");
const personal = makeSource("personal", "outlook-account");
const feed = makeSource("feed", "ics-account", ["pull"], { calendarType: "ical", provider: "ics" });
const sources = [work, personal, feed];
const byId = new Map(sources.map((source) => [source.id, source] as const));

const firstRuleId = (draft: SetupDraft): string => draft.rules[0]?.id ?? "";

const completeDraft = (): SetupDraft => {
  const draft = createEmptyDraft();
  const ruleId = firstRuleId(draft);
  return setBlank(setBlank(draft, ruleId, "from", "work"), ruleId, "to", "personal");
};

describe("setBlank", () => {
  it("clears a destination that collides with the new source", () => {
    const draft = completeDraft();
    const next = setBlank(draft, firstRuleId(draft), "from", "personal");
    expect(next.rules[0]).toMatchObject({ fromId: "personal", toId: null });
  });

  it("inherits the detail already chosen for that source", () => {
    const draft = completeDraft();
    const second = addRule(setRuleDetail(draft, firstRuleId(draft), "busy"));
    const secondId = second.rules[1]?.id ?? "";
    const next = setBlank(second, secondId, "from", "work");
    expect(next.rules[1]?.detail).toBe("busy");
  });
});

describe("setRuleDetail", () => {
  it("applies to every rule sharing the same source calendar", () => {
    const draft = addRule(completeDraft());
    const secondId = draft.rules[1]?.id ?? "";
    const shared = setBlank(setBlank(draft, secondId, "from", "work"), secondId, "to", "feed");
    const next = setRuleDetail(shared, firstRuleId(shared), "titles");
    expect(next.rules.map((rule) => rule.detail)).toEqual(["titles", "titles"]);
  });
});

describe("canReverse", () => {
  it("allows a pair where both calendars can push and pull", () => {
    const draft = completeDraft();
    expect(canReverse(draft, firstRuleId(draft), byId)).toBe(true);
  });

  it("refuses when the source cannot receive events", () => {
    const draft = createEmptyDraft();
    const ruleId = firstRuleId(draft);
    const fromFeed = setBlank(setBlank(draft, ruleId, "from", "feed"), ruleId, "to", "work");
    expect(canReverse(fromFeed, ruleId, byId)).toBe(false);
  });

  it("refuses once the reverse rule exists", () => {
    const draft = completeDraft();
    const reversed = addReverseRule(draft, firstRuleId(draft));
    expect(reversed.rules).toHaveLength(2);
    expect(reversed.rules[1]).toMatchObject({ fromId: "personal", toId: "work" });
    expect(canReverse(reversed, firstRuleId(reversed), byId)).toBe(false);
  });
});

describe("resolveConnectedAccount", () => {
  it("fills the blank the user left to connect the account", () => {
    const draft = createEmptyDraft();
    const ruleId = firstRuleId(draft);
    const pending = markPending(draft, ruleId, "to");
    const next = resolveConnectedAccount(pending, sources, "outlook-account");
    expect(next.pending).toBeNull();
    expect(next.rules.find((rule) => rule.id === ruleId)?.toId).toBe("personal");
  });

  it("will not fill a destination with a feed that only pulls", () => {
    const draft = createEmptyDraft();
    const pending = markPending(draft, firstRuleId(draft), "to");
    const next = resolveConnectedAccount(pending, sources, "ics-account");
    expect(next.pending).toBeNull();
    expect(next.rules[0]?.toId).toBeNull();
  });

  it("fills the first empty blank when nothing was pending", () => {
    const next = resolveConnectedAccount(createEmptyDraft(), sources, "google-account");
    expect(next.rules[0]).toMatchObject({ fromId: "work", toId: null });
  });

  it("appends a rule when every blank is already filled", () => {
    const next = resolveConnectedAccount(completeDraft(), sources, "ics-account");
    expect(next.rules).toHaveLength(2);
    expect(next.rules[1]).toMatchObject({ fromId: "feed", toId: null });
  });

  it("starts a fresh sentence from a pull-only account", () => {
    const next = resolveNewAccountDraft(sources, "ics-account");
    expect(next.rules[0]).toMatchObject({ fromId: "feed", toId: null });
  });
});

describe("pruneStaleIds", () => {
  it("drops calendars that no longer exist and keeps the draft otherwise", () => {
    const draft = completeDraft();
    expect(pruneStaleIds(draft, sources)).toBe(draft);
    const pruned = pruneStaleIds(draft, [work]);
    expect(pruned.rules[0]).toMatchObject({ fromId: "work", toId: null });
  });
});

describe("removeRulesFrom", () => {
  it("removes committed rules for a source and leaves one blank rule", () => {
    const next = removeRulesFrom(completeDraft(), "work");
    expect(next.rules).toHaveLength(1);
    expect(next.rules[0]).toMatchObject({ fromId: null, toId: null });
  });
});
