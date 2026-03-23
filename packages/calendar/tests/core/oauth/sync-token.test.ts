import { describe, expect, it } from "bun:test";
import {
  decodeStoredSyncToken,
  encodeStoredSyncToken,
  resolveSyncTokenForWindow,
} from "../../../src/core/oauth/sync-token";

describe("sync token versioning", () => {
  it("treats legacy plain token as version zero", () => {
    const decoded = decodeStoredSyncToken("legacy-google-sync-token");
    expect(decoded.syncToken).toBe("legacy-google-sync-token");
    expect(decoded.syncWindowVersion).toBe(0);
  });

  it("encodes and decodes current-version tokens", () => {
    const encoded = encodeStoredSyncToken(
      "https://graph.microsoft.com/v1.0/me/calendars/123/delta?$deltatoken=abc",
      1,
    );

    const decoded = decodeStoredSyncToken(encoded);
    expect(decoded.syncToken).toBe(
      "https://graph.microsoft.com/v1.0/me/calendars/123/delta?$deltatoken=abc",
    );
    expect(decoded.syncWindowVersion).toBe(1);
  });

  it("forces full sync when stored token version is stale", () => {
    const legacyResolution = resolveSyncTokenForWindow("legacy-token", 1);
    expect(legacyResolution.syncToken).toBeNull();
    expect(legacyResolution.requiresBackfill).toBeTrue();
  });

  it("uses token when stored version matches required version", () => {
    const encoded = encodeStoredSyncToken("valid-token", 1);
    const resolution = resolveSyncTokenForWindow(encoded, 1);
    expect(resolution.syncToken).toBe("valid-token");
    expect(resolution.requiresBackfill).toBeFalse();
  });
});
