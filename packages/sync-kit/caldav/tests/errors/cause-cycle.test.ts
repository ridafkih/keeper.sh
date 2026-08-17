import { describe, expect, test } from "vitest";
import { decodeDavError } from "../../src/errors/dav-error";

interface Cyclic {
  message: string;
  cause: unknown;
}

const selfReferencing = (): Cyclic => {
  const error: Cyclic = { message: "it points at itself", cause: null };
  error.cause = error;
  return error;
};

const chainedTo = (depth: number): unknown => {
  let deepest: unknown = { message: "the bottom", status: 503 };
  for (let level = 0; level < depth; level += 1) {
    deepest = { message: `level ${level}`, cause: deepest };
  }
  return deepest;
};

describe("decoding an error terminates whatever the cause chain does", () => {
  test("DAV-L4: a cyclic cause chain terminates", () => {
    const decoded = decodeDavError(selfReferencing());

    expect(decoded.status).toBeNull();
    expect(decoded.precondition).toBeNull();
  }, 30_000);

  test("DAV-L4: a chain thirty-two links deep is decoded within the depth bound", () => {
    const decoded = decodeDavError(chainedTo(32));

    expect(decoded.depth).toBeLessThanOrEqual(32);
    expect(decoded.status).toBe(503);
  }, 30_000);

  test("DAV-L4: a chain past the depth bound stops rather than reading deeper", () => {
    const decoded = decodeDavError(chainedTo(2000));

    expect(decoded.depth).toBeLessThanOrEqual(32);
    expect(decoded.status).toBeNull();
  }, 30_000);
});
