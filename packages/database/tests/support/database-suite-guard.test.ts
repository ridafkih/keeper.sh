import { describe, expect, it } from "vitest";

import { assertDatabaseSuiteCanRun } from "./database-suite-guard";

describe("the database suite refuses to skip itself silently", () => {
  it("returns quietly when the database url is present", () => {
    expect(() =>
      assertDatabaseSuiteCanRun({
        KEEPER_TEST_DATABASE_URL: "postgres://keeper:keeper@127.0.0.1:5432/keeper_test",
      }),
    ).not.toThrow();
  });

  it("throws naming the variable and how to stand postgres up when the url is absent", () => {
    let thrown: unknown = null;

    try {
      assertDatabaseSuiteCanRun({});
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("KEEPER_TEST_DATABASE_URL");
    expect((thrown as Error).message).toContain("compose.yaml");
    expect((thrown as Error).message).toContain("KEEPER_TEST_DATABASE_OPTIONAL");
  });

  it("returns quietly when the opt-out is set explicitly", () => {
    expect(() => assertDatabaseSuiteCanRun({ KEEPER_TEST_DATABASE_OPTIONAL: "1" })).not.toThrow();
  });
});
