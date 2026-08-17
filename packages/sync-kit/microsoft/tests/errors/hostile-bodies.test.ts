import { describe, expect, test } from "vitest";
import { classifyGraphError } from "../../src/errors/classify";
import { decodeGraphError } from "../../src/errors/graph-error";
import { microsoftLimits } from "../../src/limits";
import { createHarness } from "../support/harness";

const bodyWithAThrowingGetter = (): unknown => ({
  statusCode: 500,
  get code(): string {
    throw new Error("an error body's getter threw during classification");
  },
});

const hostileShapes = (): readonly unknown[] => [
  null,
  [],
  "x".repeat(100_000),
  0,
  { error: "REDACTED" },
  bodyWithAThrowingGetter(),
];

describe("an error body that is not the documented shape still classifies", () => {
  test("MS-L20: an error body that is not the documented shape still classifies and never throws", () => {
    const harness = createHarness();
    const options = {
      clock: harness.environment.clock,
      retryAfterCeilingMs: microsoftLimits.retryAfterCeilingMs,
    };

    const classified = hostileShapes().map(
      (shape) => classifyGraphError(decodeGraphError(shape), "listChanges", options).kind,
    );

    expect(classified).toHaveLength(hostileShapes().length);
    expect(new Set(classified)).toEqual(new Set(["transport"]));
  });
});
