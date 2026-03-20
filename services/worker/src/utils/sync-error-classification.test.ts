import { describe, expect, it } from "bun:test";
import { classifySyncError } from "./sync-error-classification";

describe("classifySyncError", () => {
  it("classifies conflict errors", () => {
    expect(classifySyncError("snapshot conflict detected")).toBe("sync-push-conflict");
    expect(classifySyncError(new Error("HTTP 409 from provider"))).toBe("sync-push-conflict");
  });

  it("classifies timeout errors", () => {
    expect(classifySyncError("request timeout reached")).toBe("provider-api-timeout");
  });

  it("classifies rate-limit errors", () => {
    expect(classifySyncError("429 too many requests")).toBe("provider-rate-limited");
    expect(classifySyncError(new Error("rate limit exceeded"))).toBe("provider-rate-limited");
  });

  it("falls back to generic sync failure", () => {
    expect(classifySyncError("random failure")).toBe("sync-push-failed");
    expect(classifySyncError(new Error("unknown"))).toBe("sync-push-failed");
    expect(classifySyncError({})).toBe("sync-push-failed");
  });
});
