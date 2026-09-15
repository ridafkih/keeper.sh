import { describe, expect, it } from "vitest";
import {
  addReverseRule,
  addRule,
  canReverse,
  createEmptyDraft,
  markPending,
  pruneStaleIds,
  removeDestination,
  removeRulesFrom,
  resolveConnectedAccount,
  resolveNewAccountDraft,
  setBlank,
  setRuleChoice,
  takenIds,
  uniquePairs,
  type SetupBlank,
  type SetupDraft,
} from "../../../src/features/setup/setup-draft";
import { makeSource } from "./fixtures";

const FROM: SetupBlank = { kind: "from" };
const TO: SetupBlank = { index: 0, kind: "to" };
const SECOND_TO: SetupBlank = { index: 1, kind: "to" };

const work = makeSource("work", "google-account");
const personal = makeSource("personal", "outlook-account");
const family = makeSource("family", "outlook-account");
const feed = makeSource("feed", "ics-account", ["pull"], { calendarType: "ical", provider: "ics" });
const sources = [work, personal, family, feed];
const byId = new Map(sources.map((source) => [source.id, source] as const));

const firstRuleId = (draft: SetupDraft): string => draft.rules[0]?.id ?? "";

const completeDraft = (): SetupDraft => {
  const draft = createEmptyDraft();
  const ruleId = firstRuleId(draft);
  return setBlank(setBlank(draft, ruleId, FROM, "work"), ruleId, TO, "personal");
};

describe("setBlank", () => {
  it("clears a destination that collides with the new source", () => {
    const draft = completeDraft();
    const next = setBlank(draft, firstRuleId(draft), FROM, "personal");
    expect(next.rules[0]).toMatchObject({ fromId: "personal", toIds: [] });
  });

  it("keeps the chosen rule when the source changes", () => {
    const base = completeDraft();
    const draft = setRuleChoice(base, firstRuleId(base), "rule-ooo");
    const next = setBlank(draft, firstRuleId(draft), FROM, "family");
    expect(next.rules[0]).toMatchObject({ fromId: "family", syncRuleId: "rule-ooo" });
  });

  it("adds a second destination after the first and never repeats one", () => {
    const draft = completeDraft();
    const ruleId = firstRuleId(draft);
    const two = setBlank(draft, ruleId, SECOND_TO, "family");
    expect(two.rules[0]?.toIds).toEqual(["personal", "family"]);
    const moved = setBlank(two, ruleId, TO, "family");
    expect(moved.rules[0]?.toIds).toEqual(["family", "personal"]);
    expect(removeDestination(two, ruleId, "personal").rules[0]?.toIds).toEqual(["family"]);
  });
});

describe("takenIds", () => {
  it("keeps a destination blank from offering the source or its siblings", () => {
    const draft = setBlank(completeDraft(), firstRuleId(completeDraft()), SECOND_TO, "family");
    const rule = draft.rules[0];
    if (!rule) throw new Error("missing rule");
    const withFamily = setBlank(draft, rule.id, SECOND_TO, "family").rules[0];
    if (!withFamily) throw new Error("missing rule");
    expect(takenIds(withFamily, TO)).toEqual(["work", "family"]);
    expect(takenIds(withFamily, { index: 2, kind: "to" })).toEqual(["work", "personal", "family"]);
    expect(takenIds(withFamily, FROM)).toEqual(["personal", "family"]);
  });
});

describe("setRuleChoice", () => {
  it("only changes the sentence it was made in", () => {
    const draft = addRule(completeDraft());
    const next = setRuleChoice(draft, firstRuleId(draft), "rule-ooo");
    expect(next.rules.map((rule) => rule.syncRuleId)).toEqual(["rule-ooo", null]);
    expect(setRuleChoice(next, firstRuleId(next), null).rules[0]?.syncRuleId).toBeNull();
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
    const fromFeed = setBlank(setBlank(draft, ruleId, FROM, "feed"), ruleId, TO, "work");
    expect(canReverse(fromFeed, ruleId, byId)).toBe(false);
  });

  it("refuses once the reverse rule exists and lets it inherit the chosen rule", () => {
    const base = completeDraft();
    const draft = setRuleChoice(base, firstRuleId(base), "rule-ooo");
    const reversed = addReverseRule(draft, firstRuleId(draft), byId);
    expect(reversed.rules).toHaveLength(2);
    expect(reversed.rules[1]).toMatchObject({ fromId: "personal", syncRuleId: "rule-ooo", toIds: ["work"] });
    expect(canReverse(reversed, firstRuleId(reversed), byId)).toBe(false);
  });

  it("reverses every destination of a multi-destination rule", () => {
    const draft = completeDraft();
    const ruleId = firstRuleId(draft);
    const reversed = addReverseRule(setBlank(draft, ruleId, SECOND_TO, "family"), ruleId, byId);
    expect(reversed.rules.slice(1)).toMatchObject([
      { fromId: "personal", toIds: ["work"] },
      { fromId: "family", toIds: ["work"] },
    ]);
  });
});

describe("resolveConnectedAccount", () => {
  it("fills the blank the user left to connect the account", () => {
    const draft = createEmptyDraft();
    const ruleId = firstRuleId(draft);
    const pending = markPending(draft, ruleId, TO);
    const next = resolveConnectedAccount(pending, sources, "outlook-account");
    expect(next.pending).toBeNull();
    expect(next.rules.find((rule) => rule.id === ruleId)?.toIds).toEqual(["personal"]);
  });

  it("will not fill a destination with a feed that only pulls", () => {
    const draft = createEmptyDraft();
    const pending = markPending(draft, firstRuleId(draft), TO);
    const next = resolveConnectedAccount(pending, sources, "ics-account");
    expect(next.pending).toBeNull();
    expect(next.rules[0]?.toIds).toEqual([]);
  });

  it("fills the first empty blank when nothing was pending", () => {
    const next = resolveConnectedAccount(createEmptyDraft(), sources, "google-account");
    expect(next.rules[0]).toMatchObject({ fromId: "work", toIds: [] });
  });

  it("appends a destination when the user connected from the add pill", () => {
    const draft = completeDraft();
    const pending = markPending(draft, firstRuleId(draft), SECOND_TO);
    const next = resolveConnectedAccount(pending, sources, "outlook-account");
    expect(next.rules[0]?.toIds).toEqual(["personal", "family"]);
  });

  it("appends a rule when every blank is already filled", () => {
    const next = resolveConnectedAccount(completeDraft(), sources, "ics-account");
    expect(next.rules).toHaveLength(2);
    expect(next.rules[1]).toMatchObject({ fromId: "feed", toIds: [] });
  });

  it("starts a fresh sentence from a pull-only account", () => {
    const next = resolveNewAccountDraft(sources, "ics-account");
    expect(next.rules[0]).toMatchObject({ fromId: "feed", toIds: [] });
  });
});

describe("pruneStaleIds", () => {
  it("drops calendars that no longer exist and keeps the draft otherwise", () => {
    const draft = completeDraft();
    expect(pruneStaleIds(draft, sources)).toBe(draft);
    const pruned = pruneStaleIds(draft, [work]);
    expect(pruned.rules[0]).toMatchObject({ fromId: "work", toIds: [] });
  });
});

describe("removeRulesFrom", () => {
  it("removes committed rules for a source and leaves one blank rule", () => {
    const next = removeRulesFrom(completeDraft(), "work");
    expect(next.rules).toHaveLength(1);
    expect(next.rules[0]).toMatchObject({ fromId: null, toIds: [] });
  });
});

describe("uniquePairs", () => {
  it("lists each source → destination once, keeping the first sentence's rule", () => {
    const base = completeDraft();
    const draft = addRule(setRuleChoice(base, firstRuleId(base), "rule-ooo"));
    const secondId = draft.rules[1]?.id ?? "";
    const both = setBlank(setBlank(setBlank(draft, secondId, FROM, "work"), secondId, TO, "personal"), secondId, SECOND_TO, "family");
    expect(uniquePairs(both.rules.filter((rule) => rule.fromId !== null).map((rule) => ({ ...rule, fromId: rule.fromId ?? "" })))).toEqual([
      { fromId: "work", syncRuleId: "rule-ooo", toId: "personal" },
      { fromId: "work", syncRuleId: null, toId: "family" },
    ]);
  });
});
