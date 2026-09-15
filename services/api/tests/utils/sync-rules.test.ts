import { describe, expect, it } from "vitest";
import { DEFAULT_RULE } from "@keeper.sh/data-schemas";
import type { SyncRule } from "@keeper.sh/data-schemas";
import {
  DefaultRuleDeletionError,
  MappingNotFoundError,
  RuleContentNotAllowedError,
  RuleLimitError,
  RuleNotFoundError,
  assertRuleContentAllowed,
  runCreateRule,
  runDeleteRule,
  runSetRuleAssignments,
  runUpdateRule,
} from "../../src/utils/sync-rules";
import type { RuleUpdates } from "../../src/utils/sync-rules";

const USER_ID = "user-1";
const RULE_ID = "rule-1";
const PAIR = { destinationCalendarId: "dest-1", sourceCalendarId: "source-1" };

const makeRule = (overrides: Partial<SyncRule> = {}): SyncRule => ({
  actions: [...DEFAULT_RULE.actions],
  conditions: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  id: RULE_ID,
  isDefault: false,
  name: "Busy only",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...overrides,
});

const standupRule = (): SyncRule => makeRule({
  actions: [{ kind: "rename", template: "OOO" }],
  conditions: [{ kind: "title_contains", value: "Standup" }],
  name: "Standup",
});

describe("assertRuleContentAllowed", () => {
  it("lets a free plan keep the default projection", async () => {
    await expect(assertRuleContentAllowed(
      () => Promise.resolve(false),
      null,
      { actions: [...DEFAULT_RULE.actions], conditions: [] },
    )).resolves.toBeUndefined();
  });

  it("lets a free plan save an unchanged body", async () => {
    const rule = standupRule();
    await expect(assertRuleContentAllowed(
      () => Promise.resolve(false),
      rule,
      { actions: rule.actions, conditions: rule.conditions },
    )).resolves.toBeUndefined();
  });

  it("rejects conditions or custom actions on a free plan", async () => {
    await expect(assertRuleContentAllowed(
      () => Promise.resolve(false),
      makeRule(),
      { actions: [...DEFAULT_RULE.actions], conditions: [{ kind: "all_day" }] },
    )).rejects.toBeInstanceOf(RuleContentNotAllowedError);
    await expect(assertRuleContentAllowed(
      () => Promise.resolve(false),
      null,
      { actions: [{ kind: "skip" }], conditions: [] },
    )).rejects.toBeInstanceOf(RuleContentNotAllowedError);
  });

  it("does not consult the plan when the content is allowed anyway", async () => {
    let consulted = false;
    await assertRuleContentAllowed(
      () => {
        consulted = true;
        return Promise.resolve(true);
      },
      null,
      { actions: [...DEFAULT_RULE.actions], conditions: [] },
    );
    expect(consulted).toBe(false);
  });
});

describe("runCreateRule", () => {
  const createDependencies = (options: {
    canAdd: boolean;
    canEdit: boolean;
    currentCount: number;
    log: string[];
  }) => ({
    canAddRule: (_userId: string, nextCount: number) => {
      options.log.push(`can-add:${nextCount}`);
      return Promise.resolve(options.canAdd);
    },
    canEditRuleContent: () => Promise.resolve(options.canEdit),
    withTransaction: <TResult>(callback: (transaction: {
      acquireUserLock: (userId: string) => Promise<void>;
      countUserRules: (userId: string) => Promise<number>;
      ensureDefaultRule: (userId: string) => Promise<unknown>;
      insertRule: (input: { name: string }) => Promise<SyncRule>;
    }) => Promise<TResult>) => callback({
      acquireUserLock: (userId) => {
        options.log.push(`lock:${userId}`);
        return Promise.resolve();
      },
      countUserRules: () => Promise.resolve(options.currentCount),
      ensureDefaultRule: () => {
        options.log.push("ensure-default");
        return Promise.resolve();
      },
      insertRule: (input) => {
        options.log.push(`insert:${input.name}`);
        return Promise.resolve(makeRule({ name: input.name }));
      },
    }),
  });

  it("ensures the default rule, checks the projected count, and inserts under the user lock", async () => {
    const log: string[] = [];
    const rule = await runCreateRule(
      { actions: [...DEFAULT_RULE.actions], conditions: [], name: "Second", userId: USER_ID },
      createDependencies({ canAdd: true, canEdit: false, currentCount: 1, log }),
    );

    expect(rule.name).toBe("Second");
    expect(log).toEqual(["lock:user-1", "ensure-default", "can-add:2", "insert:Second"]);
  });

  it("throws the limit error before inserting", async () => {
    const log: string[] = [];
    await expect(runCreateRule(
      { actions: [...DEFAULT_RULE.actions], conditions: [], name: "Second", userId: USER_ID },
      createDependencies({ canAdd: false, canEdit: true, currentCount: 1, log }),
    )).rejects.toBeInstanceOf(RuleLimitError);
    expect(log).not.toContain("insert:Second");
  });

  it("gates custom content before touching the database", async () => {
    const log: string[] = [];
    await expect(runCreateRule(
      { actions: [{ kind: "skip" }], conditions: [{ kind: "all_day" }], name: "Skip", userId: USER_ID },
      createDependencies({ canAdd: true, canEdit: false, currentCount: 1, log }),
    )).rejects.toBeInstanceOf(RuleContentNotAllowedError);
    expect(log).toEqual([]);
  });
});

describe("runUpdateRule", () => {
  const createDependencies = (current: SyncRule | null, log: string[]) => ({
    canEditRuleContent: () => Promise.resolve(true),
    findRule: () => Promise.resolve(current),
    persistUpdates: (_userId: string, _ruleId: string, updates: RuleUpdates) => {
      log.push(`persist:${Object.keys(updates).join(",")}`);
      if (!current) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ ...current, ...updates });
    },
    resyncRuleDestinations: async (
      _userId: string,
      _ruleId: string,
      mutate: () => Promise<SyncRule | null>,
    ) => {
      log.push("resync");
      return await mutate();
    },
  });

  it("throws when the rule does not exist", async () => {
    await expect(runUpdateRule(
      { ruleId: RULE_ID, updates: { name: "X" }, userId: USER_ID },
      createDependencies(null, []),
    )).rejects.toBeInstanceOf(RuleNotFoundError);
  });

  it("renames without re-syncing destinations", async () => {
    const log: string[] = [];
    const updated = await runUpdateRule(
      { ruleId: RULE_ID, updates: { name: "Renamed" }, userId: USER_ID },
      createDependencies(standupRule(), log),
    );

    expect(updated.name).toBe("Renamed");
    expect(log).toEqual(["persist:name"]);
  });

  it("saves identical content without re-syncing", async () => {
    const log: string[] = [];
    const rule = standupRule();
    await runUpdateRule(
      { ruleId: RULE_ID, updates: { actions: [{ kind: "rename", template: "OOO " }] }, userId: USER_ID },
      createDependencies(rule, log),
    );

    expect(log).toEqual(["persist:actions"]);
  });

  it("re-syncs destinations when conditions or actions change", async () => {
    const log: string[] = [];
    await runUpdateRule(
      { ruleId: RULE_ID, updates: { conditions: [{ kind: "all_day" }] }, userId: USER_ID },
      createDependencies(standupRule(), log),
    );

    expect(log).toEqual(["resync", "persist:conditions"]);
  });
});

describe("runDeleteRule", () => {
  it("refuses to delete the default rule", async () => {
    let deleted = false;
    await expect(runDeleteRule(
      { ruleId: RULE_ID, userId: USER_ID },
      {
        deleteRule: () => {
          deleted = true;
          return Promise.resolve(RULE_ID);
        },
        findRule: () => Promise.resolve(makeRule({ isDefault: true })),
        resyncRuleDestinations: (_userId, _ruleId, mutate) => mutate(),
      },
    )).rejects.toBeInstanceOf(DefaultRuleDeletionError);
    expect(deleted).toBe(false);
  });

  it("throws when the rule is missing", async () => {
    await expect(runDeleteRule(
      { ruleId: RULE_ID, userId: USER_ID },
      {
        deleteRule: () => Promise.resolve(null),
        findRule: () => Promise.resolve(null),
        resyncRuleDestinations: (_userId, _ruleId, mutate) => mutate(),
      },
    )).rejects.toBeInstanceOf(RuleNotFoundError);
  });

  it("deletes inside the re-sync wrapper so orphaned copies are reconciled", async () => {
    const log: string[] = [];
    await runDeleteRule(
      { ruleId: RULE_ID, userId: USER_ID },
      {
        deleteRule: () => {
          log.push("delete");
          return Promise.resolve(RULE_ID);
        },
        findRule: () => Promise.resolve(standupRule()),
        resyncRuleDestinations: async (_userId, _ruleId, mutate) => {
          log.push("resync:start");
          const result = await mutate();
          log.push("resync:end");
          return result;
        },
      },
    );

    expect(log).toEqual(["resync:start", "delete", "resync:end"]);
  });
});

describe("runSetRuleAssignments", () => {
  const createDependencies = (options: {
    log: string[];
    owned: string[];
    pairExists: boolean;
  }) => ({
    withTransaction: <TResult>(callback: (transaction: {
      acquireUserLock: (userId: string) => Promise<void>;
      findOwnedRuleIds: (userId: string, ruleIds: string[]) => Promise<string[]>;
      pairExists: (userId: string, pair: typeof PAIR) => Promise<boolean>;
      replaceAssignments: (pair: typeof PAIR, ruleIds: string[]) => Promise<void>;
      requestUserSync?: (userId: string) => Promise<void>;
    }) => Promise<TResult>) => callback({
      acquireUserLock: (userId) => {
        options.log.push(`lock:${userId}`);
        return Promise.resolve();
      },
      findOwnedRuleIds: () => Promise.resolve(options.owned),
      pairExists: () => Promise.resolve(options.pairExists),
      replaceAssignments: (_pair, ruleIds) => {
        options.log.push(`replace:${ruleIds.join(",")}`);
        return Promise.resolve();
      },
      requestUserSync: (userId) => {
        options.log.push(`request:${userId}`);
        return Promise.resolve();
      },
    }),
  });

  it("throws when the pair is not mapped", async () => {
    const log: string[] = [];
    await expect(runSetRuleAssignments(
      { ...PAIR, ruleIds: ["rule-1"], userId: USER_ID },
      createDependencies({ log, owned: ["rule-1"], pairExists: false }),
    )).rejects.toBeInstanceOf(MappingNotFoundError);
    expect(log).toEqual(["lock:user-1"]);
  });

  it("throws when a rule belongs to someone else", async () => {
    const log: string[] = [];
    await expect(runSetRuleAssignments(
      { ...PAIR, ruleIds: ["rule-1", "rule-2"], userId: USER_ID },
      createDependencies({ log, owned: ["rule-1"], pairExists: true }),
    )).rejects.toThrow("Some rules not found");
    expect(log).toEqual(["lock:user-1"]);
  });

  it("writes the deduplicated order and requests a sync", async () => {
    const log: string[] = [];
    await runSetRuleAssignments(
      { ...PAIR, ruleIds: ["rule-2", "rule-1", "rule-2"], userId: USER_ID },
      createDependencies({ log, owned: ["rule-1", "rule-2"], pairExists: true }),
    );

    expect(log).toEqual(["lock:user-1", "replace:rule-2,rule-1", "request:user-1"]);
  });

  it("accepts an empty list without checking ownership", async () => {
    const log: string[] = [];
    await runSetRuleAssignments(
      { ...PAIR, ruleIds: [], userId: USER_ID },
      createDependencies({ log, owned: [], pairExists: true }),
    );

    expect(log).toEqual(["lock:user-1", "replace:", "request:user-1"]);
  });
});
