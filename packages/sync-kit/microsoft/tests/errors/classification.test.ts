import { describe, expect, test } from "vitest";
import { classifyGraphError } from "../../src/errors/classify";
import { decodeGraphError } from "../../src/errors/graph-error";
import { microsoftLimits } from "../../src/limits";
import { createHarness } from "../support/harness";

const graphErrors = [
  { statusCode: 410, code: "resyncRequired", expected: "gone" },
  { statusCode: 410, code: "syncStateNotFound", expected: "gone" },
  { statusCode: 401, code: "InvalidAuthenticationToken", expected: "authRequired" },
  { statusCode: 403, code: "ErrorAccessDenied", expected: "authRequired" },
  { statusCode: 404, code: "ErrorItemNotFound", expected: "notFound" },
  { statusCode: 409, code: "ExtensionError", expected: "duplicate" },
  { statusCode: 412, code: "ErrorIrresolvableConflict", expected: "conflict" },
  { statusCode: 429, code: "activityLimitReached", expected: "throttled" },
  { statusCode: 503, code: "UnknownError", expected: "throttled" },
  { statusCode: 500, code: "internalServerError", expected: "transport" },
  { statusCode: 501, code: "ErrorInternalServerError", expected: "unsupported" },
] as const;

describe("failures are classified by discriminant, never by message text", () => {
  test("MS-O37: every documented Graph error shape classifies by discriminant", () => {
    const harness = createHarness();
    const options = {
      clock: harness.environment.clock,
      retryAfterCeilingMs: microsoftLimits.retryAfterCeilingMs,
    };

    const classified = graphErrors.map((shape) =>
      classifyGraphError(
        decodeGraphError({
          statusCode: shape.statusCode,
          code: shape.code,
          message: "a message that must never be matched on",
        }),
        "listChanges",
        options,
      ).kind,
    );

    expect(classified).toEqual(graphErrors.map((shape) => shape.expected));
  });

  test("MS-O37: the same status with a changed message classifies identically", () => {
    const harness = createHarness();
    const options = {
      clock: harness.environment.clock,
      retryAfterCeilingMs: microsoftLimits.retryAfterCeilingMs,
    };

    const first = classifyGraphError(
      decodeGraphError({ statusCode: 410, code: "resyncRequired", message: "one wording" }),
      "listChanges",
      options,
    );
    const second = classifyGraphError(
      decodeGraphError({ statusCode: 410, code: "resyncRequired", message: "a different wording" }),
      "listChanges",
      options,
    );

    expect(second).toEqual(first);
  });
});
