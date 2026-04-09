import { describe, expect, it } from "vitest";

describe("createCalDAVSyncProvider", () => {
  it("returns a provider with pushEvents, deleteEvents, and listRemoteEvents", async () => {
    const { createCalDAVSyncProvider } = await import("../../../../src/providers/caldav/destination/provider");

    const provider = createCalDAVSyncProvider({
      calendarUrl: "https://caldav.example.com/calendar/",
      serverUrl: "https://caldav.example.com",
      username: "user",
      password: "pass",
    });

    expect(typeof provider.pushEvents).toBe("function");
    expect(typeof provider.deleteEvents).toBe("function");
    expect(typeof provider.listRemoteEvents).toBe("function");
  });
});
