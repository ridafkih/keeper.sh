import { describe, expect, it } from "vitest";
import { CalendarFetchError } from "@keeper.sh/calendar/ics";
import { RequestTimeoutError } from "@keeper.sh/calendar";
import { UrlSafetyError } from "@keeper.sh/calendar/safe-fetch";
import {
  SourceLimitError,
  runSourceCreationPreflight,
  runCreateSource,
} from "../../src/utils/source-lifecycle";
import type { InvalidSourceUrlError } from "../../src/utils/source-lifecycle";

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

describe("runSourceCreationPreflight", () => {
  it("rejects source creation before validation when the plan limit is exceeded", async () => {
    const validationCalls: string[] = [];

    await expect(
      runSourceCreationPreflight(
        {
          name: "Team Feed",
          url: "https://example.com/team.ics",
          userId: "user-1",
        },
        {
          canAddAccount: () => Promise.resolve(false),
          countExistingAccounts: () => Promise.resolve(3),
          validateSourceUrl: () => {
            validationCalls.push("validated");
            return Promise.resolve();
          },
        },
      ),
    ).rejects.toBeInstanceOf(SourceLimitError);

    expect(validationCalls).toEqual([]);
  });

  it("wraps CalendarFetchError details in InvalidSourceUrlError", async () => {
    const rejection = new CalendarFetchError("auth needed", "auth_required", 401);

    await expect(
      runSourceCreationPreflight(
        {
          name: "Team Feed",
          url: "https://example.com/private.ics",
          userId: "user-1",
        },
        {
          canAddAccount: () => Promise.resolve(true),
          countExistingAccounts: () => Promise.resolve(0),
          validateSourceUrl: () => Promise.reject(rejection),
        },
      ),
    ).rejects.toMatchObject({
      authRequired: true,
      message: "auth needed",
      reason: "auth_required",
    });
  });

  const rejectWith = (cause: unknown) =>
    runSourceCreationPreflight(
      { name: "Team Feed", url: "https://example.com/team.ics", userId: "user-1" },
      {
        canAddAccount: () => Promise.resolve(true),
        countExistingAccounts: () => Promise.resolve(0),
        validateSourceUrl: () => Promise.reject(cause),
      },
    );

  it("says a page that is not an iCal file was rejected for that reason", async () => {
    await expect(
      rejectWith(new CalendarFetchError("not an ics file", "not_ical")),
    ).rejects.toMatchObject({ reason: "not_ical" });
  });

  it("says a URL pointing at a private address was refused as unsafe", async () => {
    await expect(rejectWith(new UrlSafetyError("private address"))).rejects.toMatchObject({
      reason: "unsafe_url",
    });
  });

  it("says a feed that took too long timed out", async () => {
    await expect(rejectWith(new RequestTimeoutError(15_000))).rejects.toMatchObject({
      reason: "timeout",
    });
  });

  it("says a feed that could not be reached was unreachable", async () => {
    await expect(rejectWith(new TypeError("fetch failed"))).rejects.toMatchObject({
      reason: "unreachable",
    });
  });

  it("wraps unknown validation failures without exposing their details", async () => {
    await expect(
      runSourceCreationPreflight(
        {
          name: "Team Feed",
          url: "https://example.com/broken.ics",
          userId: "user-1",
        },
        {
          canAddAccount: () => Promise.resolve(true),
          countExistingAccounts: () => Promise.resolve(0),
          validateSourceUrl: () => Promise.reject(new Error("internal detail")),
        },
      ),
    ).rejects.toEqual(expect.objectContaining<Partial<InvalidSourceUrlError>>({
      authRequired: false,
      message: "Invalid calendar URL",
    }));
  });
});

describe("runCreateSource", () => {
  it("rejects source creation when plan limit is exceeded", async () => {
    await expect(
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
        },
      ),
    ).rejects.toBeInstanceOf(SourceLimitError);
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
      },
    );

    expect(result).toEqual(createdSource);
    expect(backgroundCallback).not.toBe(missingSourceLifecycleCallback);

    await backgroundCallback();

    expect(fetchSyncedSourceIds).toEqual(["source-99"]);
    expect(syncedUserIds).toEqual(["user-42"]);
  });

  it("throws when calendar account creation fails", async () => {
    await expect(
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
        },
      ),
    ).rejects.toThrow("Failed to create calendar account");
  });

  it("throws when source calendar creation fails", async () => {
    await expect(
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
        },
      ),
    ).rejects.toThrow("Failed to create source");
  });
});
