import { describe, expect, it } from "vitest";

describe("createOutlookSyncProvider", () => {
  it("returns a provider with pushEvents, deleteEvents, and listRemoteEvents", async () => {
    const { createOutlookSyncProvider } = await import("../../../../src/providers/outlook/destination/provider");

    const provider = createOutlookSyncProvider({
      accessToken: "test-token",
      refreshToken: "test-refresh",
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      externalCalendarId: "external-cal-1",
      calendarId: "cal-1",
      userId: "user-1",
    });

    expect(typeof provider.pushEvents).toBe("function");
    expect(typeof provider.deleteEvents).toBe("function");
    expect(typeof provider.listRemoteEvents).toBe("function");
  });
});
