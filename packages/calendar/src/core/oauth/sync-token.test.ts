import { describe, expect, it } from "bun:test";
import {
  decodeStoredSyncToken,
  encodeStoredSyncToken,
  resolveSyncTokenForWindow,
} from "./sync-token";

describe("sync token versioning", () => {
  it("rejects unversioned stored tokens", () => {
    const decoded = decodeStoredSyncToken("legacy-google-sync-token");
    expect(decoded).toBeNull();
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

  it("forces full sync for unversioned stored token", () => {
    const resolution = resolveSyncTokenForWindow("legacy-token", 1);
    expect(resolution.syncToken).toBeNull();
    expect(resolution.requiresBackfill).toBeTrue();
  });

  it("forces full sync when stored token version is stale", () => {
    const encoded = encodeStoredSyncToken("stale-token", 0);
    const resolution = resolveSyncTokenForWindow(encoded, 1);
    expect(resolution.syncToken).toBeNull();
    expect(resolution.requiresBackfill).toBeTrue();
  });

  it("uses token when stored version matches required version", () => {
    const encoded = encodeStoredSyncToken("valid-token", 1);
    const resolution = resolveSyncTokenForWindow(encoded, 1);
    expect(resolution.syncToken).toBe("valid-token");
    expect(resolution.requiresBackfill).toBeFalse();
  });
});
