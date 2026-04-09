import { describe, expect, it } from "vitest";

describe("createGoogleSyncProvider", () => {
  it("returns a provider with pushEvents, deleteEvents, and listRemoteEvents", async () => {
    const { createGoogleSyncProvider } = await import("../../../../src/providers/google/destination/provider");

    const provider = createGoogleSyncProvider({
      accessToken: "test-token",
      refreshToken: "test-refresh",
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      externalCalendarId: "primary",
      calendarId: "cal-1",
      userId: "user-1",
    });

    expect(typeof provider.pushEvents).toBe("function");
    expect(typeof provider.deleteEvents).toBe("function");
    expect(typeof provider.listRemoteEvents).toBe("function");
  });
});
