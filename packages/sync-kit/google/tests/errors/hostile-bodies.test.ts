import { describe, expect, test } from "vitest";
import { classifyGoogleError } from "../../src/errors/classify";
import { decodeGaxiosError } from "../../src/errors/gaxios-error";

const emptyBody = { name: "GaxiosError", response: { status: 502, data: "" } };
const nonJsonBody = {
  name: "GaxiosError",
  response: { status: 500, data: "<html>backend error</html>" },
};
const redactedBody = { name: "GaxiosError", response: { status: 403, data: "REDACTED" } };

describe("a hostile error body classifies rather than throwing", () => {
  test("GOOG-O24: an empty, a non-JSON and a redacted error body each classify without throwing", () => {
    const decoded = [emptyBody, nonJsonBody, redactedBody].map((error) =>
      decodeGaxiosError(error),
    );

    const classified = decoded.map((entry) => classifyGoogleError(entry, "listChanges").kind);

    expect(decoded.map((entry) => entry.status)).toEqual([502, 500, 403]);
    expect(classified).toHaveLength(3);
  });

  test("GOOG-O24: an error that is not an object at all still decodes", () => {
    expect(decodeGaxiosError("the transport threw a string")).toEqual({
      status: null,
      reasons: [],
      retryAfter: null,
    });
  });

  test("GOOG-O24: the status is read before anything can redact it", () => {
    const decoded = decodeGaxiosError({
      name: "GaxiosError",
      response: {
        status: 429,
        headers: { "retry-after": "30" },
        data: { error: { code: 429, errors: [{ reason: "rateLimitExceeded" }] } },
      },
    });

    expect(decoded.status).toBe(429);
    expect(decoded.reasons).toContain("rateLimitExceeded");
  });
});
