import { describe, expect, test } from "vitest";
import { classifyGraphError } from "../../src/errors/classify";
import { decodeGraphError } from "../../src/errors/graph-error";
import { microsoftLimits } from "../../src/limits";
import { createHarness } from "../support/harness";
import { filesMatchingPattern } from "../support/sources";

const httpStatusLiteral = /\b(?:4[0-9]{2}|5[0-9]{2})\b/;

const allowedElsewhere = new Set([
  "src/capabilities.ts",
  "src/errors/classify.ts",
  "src/errors/graph-error.ts",
  "src/errors/retry-after.ts",
  "src/errors/to-provider-failure.ts",
]);

describe("status codes live at one boundary and nowhere else", () => {
  test("MS-H6: no module outside src/errors reads a status code", async () => {
    const harness = createHarness();
    const matched = await filesMatchingPattern("src", httpStatusLiteral);
    const offenders = matched.filter((file) => !allowedElsewhere.has(file));

    expect(offenders).toEqual([]);
    expect(
      classifyGraphError(decodeGraphError({ statusCode: 410, code: "resyncRequired" }), "listChanges", {
        clock: harness.environment.clock,
        retryAfterCeilingMs: microsoftLimits.retryAfterCeilingMs,
      }).kind,
    ).toBe("gone");
  });
});
