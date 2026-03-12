import { describe, expect, it } from "bun:test";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { ProcessEventsOptions, SourceEvent, SourceSyncResult } from "@keeper.sh/provider-core";
import { OutlookSourceProvider } from "./provider";

class TestableOutlookSourceProvider extends OutlookSourceProvider {
  runProcessEvents(events: SourceEvent[], options: ProcessEventsOptions): Promise<SourceSyncResult> {
    return this.processEvents(events, options);
  }
}

describe("OutlookSourceProvider", () => {
  it("does not clear stored source events before forcing full resync", async () => {
    let deleteCalled = false;
    let syncTokenResetCalls = 0;
    const mockDatabase = {
      delete: () => {
        deleteCalled = true;
        return {
          where: () => Promise.resolve(),
        };
      },
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ id: "out-of-range-state" }]),
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => {
            syncTokenResetCalls += 1;
            return Promise.resolve();
          },
        }),
      }),
    };

    const provider = new TestableOutlookSourceProvider(
      {
        accessToken: "access-token",
        accessTokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
        calendarAccountId: "account-1",
        calendarId: "calendar-1",
        database: mockDatabase as unknown as BunSQLDatabase,
        deltaLink: "delta-link-token",
        externalCalendarId: "calendar@example.com",
        oauthCredentialId: "credential-1",
        originalName: "Original Calendar",
        refreshToken: "refresh-token",
        sourceName: "Calendar",
        syncToken: "delta-link-token",
        userId: "user-1",
      },
      {
        refreshAccessToken: () => Promise.reject(new Error("refreshAccessToken should not be called")),
      },
    );

    const result = await provider.runProcessEvents([], { isDeltaSync: true });

    expect(result.fullSyncRequired).toBe(true);
    expect(deleteCalled).toBe(false);
    expect(syncTokenResetCalls).toBe(1);
  });
});
