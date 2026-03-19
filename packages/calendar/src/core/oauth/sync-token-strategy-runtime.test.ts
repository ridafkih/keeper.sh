import { describe, expect, it } from "bun:test";
import {
  resolveSourceSyncTokenActionFromMachine,
  resolveSyncTokenFromMachine,
} from "./sync-token-strategy-runtime";

describe("resolveSyncTokenFromMachine", () => {
  it("resolves valid token when window version matches", () => {
    const resolution = resolveSyncTokenFromMachine({
      loadedWindowVersion: 3,
      requiredWindowVersion: 3,
      token: "token-1",
    });

    expect(resolution.requiresBackfill).toBe(false);
    expect(resolution.resolvedToken).toBe("token-1");
  });

  it("requests backfill when loaded token version is stale", () => {
    const resolution = resolveSyncTokenFromMachine({
      loadedWindowVersion: 1,
      requiredWindowVersion: 2,
      token: "old-token",
    });

    expect(resolution.requiresBackfill).toBe(true);
    expect(resolution.resolvedToken).toBeNull();
  });
});

describe("resolveSourceSyncTokenActionFromMachine", () => {
  it("persists next token when delta sync returns one", () => {
    const action = resolveSourceSyncTokenActionFromMachine({
      isDeltaSync: true,
      nextSyncToken: "next-token",
    });

    expect(action.shouldResetSyncToken).toBe(false);
    expect(action.nextSyncTokenToPersist).toBe("next-token");
  });

  it("resets token when delta sync returns no next token", () => {
    const action = resolveSourceSyncTokenActionFromMachine({
      isDeltaSync: true,
      nextSyncToken: "",
    });

    expect(action.shouldResetSyncToken).toBe(true);
    expect(action.nextSyncTokenToPersist).toBeUndefined();
  });
});
