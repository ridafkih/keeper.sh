import { describe, expect, it } from "vitest";
import {
  handleGetPairRulesRoute,
  handlePutPairRulesRoute,
} from "../../src/handlers/sync-rule-assignment-routes";
import { MappingNotFoundError } from "../../src/utils/sync-rules";

const USER_ID = "user-1";
const PARAMS = { destinationId: "dest-1", id: "source-1" };

const readError = async (response: Response): Promise<string | null> => {
  const body = await response.json() as { error: string | null };
  return body.error;
};

describe("handleGetPairRulesRoute", () => {
  it("returns 400 when either id is missing", async () => {
    const response = await handleGetPairRulesRoute(
      { params: { id: "source-1" }, userId: USER_ID },
      { getRuleAssignments: () => Promise.reject(new Error("must not be called")) },
    );

    expect(response.status).toBe(400);
  });

  it("accepts the repeated source id Bun's router produces for nested params", async () => {
    let received: unknown = null;
    const response = await handleGetPairRulesRoute(
      { params: { destinationId: "dest-1", id: ["source-1", "source-1"] }, userId: USER_ID },
      {
        getRuleAssignments: (_userId, pair) => {
          received = pair;
          return Promise.resolve([]);
        },
      },
    );

    expect(response.status).toBe(200);
    expect(received).toEqual({ destinationCalendarId: "dest-1", sourceCalendarId: "source-1" });
  });

  it("returns 404 when the pair is not mapped", async () => {
    const response = await handleGetPairRulesRoute(
      { params: PARAMS, userId: USER_ID },
      { getRuleAssignments: () => Promise.resolve(null) },
    );

    expect(response.status).toBe(404);
    expect(await readError(response)).toBe("Mapping not found.");
  });

  it("returns the ordered rule ids for the pair", async () => {
    let received: unknown = null;
    const response = await handleGetPairRulesRoute(
      { params: PARAMS, userId: USER_ID },
      {
        getRuleAssignments: (_userId, pair) => {
          received = pair;
          return Promise.resolve(["rule-2", "rule-1"]);
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ruleIds: ["rule-2", "rule-1"] });
    expect(received).toEqual({ destinationCalendarId: "dest-1", sourceCalendarId: "source-1" });
  });
});

describe("handlePutPairRulesRoute", () => {
  it("returns 400 without a ruleIds array", async () => {
    const response = await handlePutPairRulesRoute(
      { body: { ruleIds: "rule-1" }, params: PARAMS, userId: USER_ID },
      { setRuleAssignments: () => Promise.reject(new Error("must not be called")) },
    );

    expect(response.status).toBe(400);
    expect(await readError(response)).toBe("ruleIds array is required");
  });

  it("maps domain errors to 404 and 400", async () => {
    const missing = await handlePutPairRulesRoute(
      { body: { ruleIds: [] }, params: PARAMS, userId: USER_ID },
      { setRuleAssignments: () => Promise.reject(new MappingNotFoundError("Mapping not found.")) },
    );
    const unowned = await handlePutPairRulesRoute(
      { body: { ruleIds: ["rule-9"] }, params: PARAMS, userId: USER_ID },
      { setRuleAssignments: () => Promise.reject(new Error("Some rules not found")) },
    );

    expect(missing.status).toBe(404);
    expect(unowned.status).toBe(400);
    expect(await readError(unowned)).toBe("Some rules not found");
  });

  it("returns success after writing the assignments", async () => {
    let received: unknown = null;
    const response = await handlePutPairRulesRoute(
      { body: { ruleIds: ["rule-1"] }, params: PARAMS, userId: USER_ID },
      {
        setRuleAssignments: (_userId, pair, ruleIds) => {
          received = { pair, ruleIds };
          return Promise.resolve();
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(received).toEqual({
      pair: { destinationCalendarId: "dest-1", sourceCalendarId: "source-1" },
      ruleIds: ["rule-1"],
    });
  });
});
