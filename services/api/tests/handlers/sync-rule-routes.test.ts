import { describe, expect, it } from "vitest";
import { DEFAULT_RULE } from "@keeper.sh/data-schemas";
import type { SyncRule } from "@keeper.sh/data-schemas";
import {
  handleCreateRuleRoute,
  handleDeleteRuleRoute,
  handleGetRuleRoute,
  handleListRulesRoute,
  handlePatchRuleRoute,
} from "../../src/handlers/sync-rule-routes";
import {
  DefaultRuleDeletionError,
  RuleContentNotAllowedError,
  RuleLimitError,
  RuleNotFoundError,
} from "../../src/utils/sync-rules";

const USER_ID = "user-1";

const makeRule = (overrides: Partial<SyncRule> = {}): SyncRule => ({
  actions: [...DEFAULT_RULE.actions],
  conditions: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  id: "rule-1",
  isDefault: true,
  name: "Busy only",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...overrides,
});

const readError = async (response: Response): Promise<string | null> => {
  const body = await response.json() as { error: string | null };
  return body.error;
};

describe("handleListRulesRoute", () => {
  it("ensures the default rule before listing", async () => {
    const log: string[] = [];
    const response = await handleListRulesRoute(
      { userId: USER_ID },
      {
        ensureDefaultRule: () => {
          log.push("ensure");
          return Promise.resolve();
        },
        listRules: () => {
          log.push("list");
          return Promise.resolve([{ ...makeRule(), assignmentCount: 2 }]);
        },
      },
    );

    expect(response.status).toBe(200);
    expect(log).toEqual(["ensure", "list"]);
    expect(await response.json()).toEqual([{ ...makeRule(), assignmentCount: 2 }]);
  });
});

const rejectCall = () => Promise.reject(new Error("must not be called"));

describe("handleCreateRuleRoute", () => {
  it("returns 400 when the body has no name", async () => {
    const response = await handleCreateRuleRoute(
      { body: { conditions: [] }, userId: USER_ID },
      { createRule: rejectCall },
    );

    expect(response.status).toBe(400);
    expect(await readError(response)).toBe("Rule name is required.");
  });

  it("returns 400 for a blank name", async () => {
    const response = await handleCreateRuleRoute(
      { body: { name: "   " }, userId: USER_ID },
      { createRule: rejectCall },
    );

    expect(response.status).toBe(400);
    expect(await readError(response)).toBe("Rule name cannot be empty.");
  });

  it("returns 400 for an unknown condition kind", async () => {
    const response = await handleCreateRuleRoute(
      { body: { conditions: [{ kind: "weekend" }], name: "Weekend" }, userId: USER_ID },
      { createRule: rejectCall },
    );

    expect(response.status).toBe(400);
  });

  it("creates with the default content when none is given", async () => {
    let received: unknown = null;
    const response = await handleCreateRuleRoute(
      { body: { name: "  Second  " }, userId: USER_ID },
      {
        createRule: (_userId, input) => {
          received = input;
          return Promise.resolve(makeRule({ id: "rule-2", isDefault: false, name: input.name }));
        },
      },
    );

    expect(response.status).toBe(201);
    expect(received).toEqual({
      actions: DEFAULT_RULE.actions,
      conditions: [],
      name: "Second",
    });
  });

  it("maps the limit and content errors to 403", async () => {
    const limited = await handleCreateRuleRoute(
      { body: { name: "Second" }, userId: USER_ID },
      { createRule: () => Promise.reject(new RuleLimitError("limit")) },
    );
    const gated = await handleCreateRuleRoute(
      { body: { actions: [{ kind: "skip" }], name: "Skip" }, userId: USER_ID },
      { createRule: () => Promise.reject(new RuleContentNotAllowedError("pro")) },
    );

    expect(limited.status).toBe(403);
    expect(await readError(limited)).toBe("limit");
    expect(gated.status).toBe(403);
    expect(await readError(gated)).toBe("pro");
  });
});

describe("handleGetRuleRoute", () => {
  it("returns 400 without an id and 404 for a missing rule", async () => {
    const missingId = await handleGetRuleRoute(
      { params: {}, userId: USER_ID },
      { findRule: () => Promise.resolve(null) },
    );
    const missingRule = await handleGetRuleRoute(
      { params: { id: "rule-9" }, userId: USER_ID },
      { findRule: () => Promise.resolve(null) },
    );

    expect(missingId.status).toBe(400);
    expect(missingRule.status).toBe(404);
  });

  it("returns the rule with its assignments", async () => {
    const detail = { ...makeRule(), assignments: [{ destinationId: "d", sourceId: "s" }] };
    const response = await handleGetRuleRoute(
      { params: { id: "rule-1" }, userId: USER_ID },
      { findRule: () => Promise.resolve(detail) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(detail);
  });
});

describe("handlePatchRuleRoute", () => {
  it("returns 400 for an empty or unknown-field body", async () => {
    const empty = await handlePatchRuleRoute(
      { body: {}, params: { id: "rule-1" }, userId: USER_ID },
      { updateRule: rejectCall },
    );
    const unknown = await handlePatchRuleRoute(
      { body: { isDefault: true }, params: { id: "rule-1" }, userId: USER_ID },
      { updateRule: rejectCall },
    );

    expect(empty.status).toBe(400);
    expect(await readError(empty)).toBe("No valid fields to update");
    expect(unknown.status).toBe(400);
  });

  it("returns 400 for a blank name", async () => {
    const response = await handlePatchRuleRoute(
      { body: { name: " " }, params: { id: "rule-1" }, userId: USER_ID },
      { updateRule: rejectCall },
    );

    expect(response.status).toBe(400);
    expect(await readError(response)).toBe("Rule name cannot be empty.");
  });

  it("passes trimmed updates through", async () => {
    let received: unknown = null;
    const response = await handlePatchRuleRoute(
      {
        body: { conditions: [{ kind: "title_contains", value: "Standup" }], name: " Standup " },
        params: { id: "rule-1" },
        userId: USER_ID,
      },
      {
        updateRule: (_userId, _ruleId, updates) => {
          received = updates;
          return Promise.resolve(makeRule({ name: "Standup" }));
        },
      },
    );

    expect(response.status).toBe(200);
    expect(received).toEqual({
      conditions: [{ kind: "title_contains", value: "Standup" }],
      name: "Standup",
    });
  });

  it("maps not found to 404 and gated content to 403", async () => {
    const missing = await handlePatchRuleRoute(
      { body: { name: "X" }, params: { id: "rule-9" }, userId: USER_ID },
      { updateRule: () => Promise.reject(new RuleNotFoundError("Rule not found.")) },
    );
    const gated = await handlePatchRuleRoute(
      { body: { actions: [{ kind: "skip" }] }, params: { id: "rule-1" }, userId: USER_ID },
      { updateRule: () => Promise.reject(new RuleContentNotAllowedError("pro")) },
    );

    expect(missing.status).toBe(404);
    expect(gated.status).toBe(403);
  });
});

describe("handleDeleteRuleRoute", () => {
  it("returns 204 on success", async () => {
    const response = await handleDeleteRuleRoute(
      { params: { id: "rule-2" }, userId: USER_ID },
      { deleteRule: () => Promise.resolve() },
    );

    expect(response.status).toBe(204);
  });

  it("returns 409 for the default rule and 404 for a missing one", async () => {
    const conflict = await handleDeleteRuleRoute(
      { params: { id: "rule-1" }, userId: USER_ID },
      { deleteRule: () => Promise.reject(new DefaultRuleDeletionError("default")) },
    );
    const missing = await handleDeleteRuleRoute(
      { params: { id: "rule-9" }, userId: USER_ID },
      { deleteRule: () => Promise.reject(new RuleNotFoundError("missing")) },
    );

    expect(conflict.status).toBe(409);
    expect(missing.status).toBe(404);
  });
});
