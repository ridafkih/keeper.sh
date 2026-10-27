import { MaxRetriesPerRequestError } from "ioredis/built/errors";
import { CONNECTION_CLOSED_ERROR_MSG } from "ioredis/built/utils";
import { describe, expect, it } from "vitest";
import { isRedisUnavailableError } from "../../../src/core/utils/redis-errors";

describe("isRedisUnavailableError", () => {
  it("recognises a command that ran out of retries while Redis was unreachable", () => {
    expect(isRedisUnavailableError(new MaxRetriesPerRequestError(3))).toBe(true);
  });

  it("recognises a command sent on a closed connection", () => {
    expect(isRedisUnavailableError(new Error(CONNECTION_CLOSED_ERROR_MSG))).toBe(true);
  });

  it("recognises a Redis failure wrapped by the caller", () => {
    const wrapped = new Error("could not acquire the source lock", {
      cause: new MaxRetriesPerRequestError(3),
    });

    expect(isRedisUnavailableError(wrapped)).toBe(true);
  });

  it("leaves provider and network failures to their own classifiers", () => {
    const reset = Object.assign(new Error("write ECONNRESET"), { code: "ECONNRESET" });

    expect(isRedisUnavailableError(reset)).toBe(false);
    expect(isRedisUnavailableError(new Error("Request failed with status 503"))).toBe(false);
    expect(isRedisUnavailableError("Connection is closed.")).toBe(false);
  });
});
