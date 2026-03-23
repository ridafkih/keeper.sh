import { describe, expect, it } from "bun:test";
import { CalendarFetchError } from "@keeper.sh/calendar/ics";
import {
  SourceLimitError,
  runCreateSource,
} from "../../src/utils/source-lifecycle";

interface TestSource {
  id: string;
  accountId: string;
  userId: string;
  name: string;
  url: string | null;
  createdAt: Date;
}

const createSourceRecord = (overrides: Partial<TestSource> = {}): TestSource => ({
  accountId: "account-1",
  createdAt: new Date("2026-03-08T12:00:00.000Z"),
  id: "source-1",
  name: "My Calendar",
  url: "https://example.com/calendar.ics",
  userId: "user-1",
  ...overrides,
});

const missingSourceLifecycleCallback = (): Promise<void> =>
  Promise.reject(new Error("Expected background callback"));

describe("runCreateSource", () => {
  it("rejects source creation when plan limit is exceeded", () => {
    expect(
      runCreateSource(
        {
          name: "Team Feed",
          url: "https://example.com/team.ics",
          userId: "user-1",
        },
        {
          acquireAccountLock: () => Promise.resolve(),
          canAddAccount: () => Promise.resolve(false),
          countExistingAccounts: () => Promise.resolve(3),
          createCalendarAccount: () => Promise.resolve("account-1"),
          createSourceCalendar: () => Promise.resolve(createSourceRecord()),
          fetchAndSyncSource: () => Promise.resolve(),
          spawnBackgroundJob: Boolean,
          enqueuePushSync: () => Promise.resolve(),
          validateSourceUrl: () => Promise.resolve(),
        },
      ),
    ).rejects.toBeInstanceOf(SourceLimitError);
  });

  it("wraps CalendarFetchError details in InvalidSourceUrlError", () => {
    const rejection = new CalendarFetchError("auth needed", 401);

    expect(
      runCreateSource(
        {
          name: "Team Feed",
          url: "https://example.com/private.ics",
          userId: "user-1",
        },
        {
          acquireAccountLock: () => Promise.resolve(),
          canAddAccount: () => Promise.resolve(true),
          countExistingAccounts: () => Promise.resolve(0),
          createCalendarAccount: () => Promise.resolve("account-1"),
          createSourceCalendar: () => Promise.resolve(createSourceRecord()),
          fetchAndSyncSource: () => Promise.resolve(),
          spawnBackgroundJob: Boolean,
          enqueuePushSync: () => Promise.resolve(),
          validateSourceUrl: () => Promise.reject(rejection),
        },
      ),
    ).rejects.toMatchObject({
      authRequired: true,
      message: "auth needed",
    });
  });

  it("creates source and schedules background fetch-sync callback", async () => {
    const createdSource = createSourceRecord({
      accountId: "account-42",
      id: "source-99",
      name: "Team Feed",
      url: "https://example.com/feed.ics",
      userId: "user-42",
    });
    let backgroundCallback: () => Promise<void> = missingSourceLifecycleCallback;
    const fetchSyncedSourceIds: string[] = [];
    const syncedUserIds: string[] = [];

    const result = await runCreateSource(
      {
        name: "Team Feed",
        url: "https://example.com/feed.ics",
        userId: "user-42",
      },
      {
        acquireAccountLock: () => Promise.resolve(),
        canAddAccount: () => Promise.resolve(true),
        countExistingAccounts: () => Promise.resolve(2),
        createCalendarAccount: () => Promise.resolve("account-42"),
        createSourceCalendar: (payload) => Promise.resolve(createSourceRecord({
            accountId: payload.accountId,
            id: "source-99",
            name: payload.name,
            url: payload.url,
            userId: payload.userId,
          })),
        fetchAndSyncSource: (source) => {
          fetchSyncedSourceIds.push(source.id);
          return Promise.resolve();
        },
        spawnBackgroundJob: (jobName, fields, callback) => {
          expect(jobName).toBe("ical-source-sync");
          expect(fields).toEqual({ calendarId: "source-99", userId: "user-42" });
          backgroundCallback = callback;
        },
        enqueuePushSync: (userId: string) => {
          syncedUserIds.push(userId);
          return Promise.resolve();
        },
        validateSourceUrl: () => Promise.resolve(),
      },
    );

    expect(result).toEqual(createdSource);
    expect(backgroundCallback).not.toBe(missingSourceLifecycleCallback);

    await backgroundCallback();

    expect(fetchSyncedSourceIds).toEqual(["source-99"]);
    expect(syncedUserIds).toEqual(["user-42"]);
  });

  it("throws when calendar account creation fails", () => {
    expect(
      runCreateSource(
        {
          name: "Team Feed",
          url: "https://example.com/feed.ics",
          userId: "user-1",
        },
        {
          acquireAccountLock: () => Promise.resolve(),
          canAddAccount: () => Promise.resolve(true),
          countExistingAccounts: () => Promise.resolve(0),
          createCalendarAccount: () => Promise.resolve(""),
          createSourceCalendar: () => Promise.resolve(createSourceRecord()),
          fetchAndSyncSource: () => Promise.resolve(),
          spawnBackgroundJob: Boolean,
          enqueuePushSync: () => Promise.resolve(),
          validateSourceUrl: () => Promise.resolve(),
        },
      ),
    ).rejects.toThrow("Failed to create calendar account");
  });

  it("throws when source calendar creation fails", () => {
    expect(
      runCreateSource(
        {
          name: "Team Feed",
          url: "https://example.com/feed.ics",
          userId: "user-1",
        },
        {
          acquireAccountLock: () => Promise.resolve(),
          canAddAccount: () => Promise.resolve(true),
          countExistingAccounts: () => Promise.resolve(0),
          createCalendarAccount: () => Promise.resolve("account-1"),
          createSourceCalendar: () =>
            Promise.resolve<TestSource | undefined>(globalThis.undefined),
          fetchAndSyncSource: () => Promise.resolve(),
          spawnBackgroundJob: Boolean,
          enqueuePushSync: () => Promise.resolve(),
          validateSourceUrl: () => Promise.resolve(),
        },
      ),
    ).rejects.toThrow("Failed to create source");
  });
});
