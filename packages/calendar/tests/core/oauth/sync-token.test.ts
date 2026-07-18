import { describe, expect, it } from "vitest";
import {
  decodeStoredSyncToken,
  encodeStoredSyncToken,
  resolveSyncTokenForWindow,
} from "../../../src/core/oauth/sync-token";
import {
  getOAuthSyncTokenVersion,
  OAUTH_SYNC_WINDOW_VERSION,
} from "../../../src/core/oauth/sync-window";

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
    expect(legacyResolution.requiresBackfill).toBe(true);
  });

  it("forces a full sync to backfill provider occurrence identity", () => {
    const tokenBeforeOccurrenceIdentity = encodeStoredSyncToken(
      "pre-occurrence-identity-token",
      OAUTH_SYNC_WINDOW_VERSION - 1,
    );

    expect(resolveSyncTokenForWindow(
      tokenBeforeOccurrenceIdentity,
      OAUTH_SYNC_WINDOW_VERSION,
    )).toEqual({
      requiresBackfill: true,
      syncToken: null,
    });
  });

  it("uses token when stored version matches required version", () => {
    const encoded = encodeStoredSyncToken("valid-token", 1);
    const resolution = resolveSyncTokenForWindow(encoded, 1);
    expect(resolution.syncToken).toBe("valid-token");
    expect(resolution.requiresBackfill).toBe(false);
  });

  it("expires provider tokens when the absolute sync window advances", () => {
    const calendarKey = "calendar-1";
    const firstWindowVersion = getOAuthSyncTokenVersion(
      0,
      new Date("2026-07-01T00:00:00Z"),
      calendarKey,
    );
    const nextWindowVersion = getOAuthSyncTokenVersion(
      0,
      new Date("2026-07-08T00:00:00Z"),
      calendarKey,
    );
    const encoded = encodeStoredSyncToken("window-bound-token", firstWindowVersion);

    expect(nextWindowVersion).toBeGreaterThan(firstWindowVersion);
    expect(resolveSyncTokenForWindow(encoded, nextWindowVersion)).toEqual({
      requiresBackfill: true,
      syncToken: null,
    });
  });

  it("accepts an already-issued fleet-boundary token after staggering is enabled", () => {
    const now = new Date("2026-07-04T12:00:00.000Z");
    const fleetVersion = getOAuthSyncTokenVersion(0, now);
    const staggeredCalendarVersion = getOAuthSyncTokenVersion(0, now, "calendar-1");
    const encoded = encodeStoredSyncToken("existing-token", fleetVersion);

    expect(staggeredCalendarVersion).toBeLessThanOrEqual(fleetVersion);
    expect(resolveSyncTokenForWindow(encoded, staggeredCalendarVersion)).toEqual({
      requiresBackfill: false,
      syncToken: "existing-token",
    });
  });
});
