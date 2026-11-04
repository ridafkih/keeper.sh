import { describe, expect, it } from "vitest";
import {
  CalDAVSourceLimitError,
  importCalDAVCalendarsWithDependencies,
} from "../../src/utils/caldav-calendar-import";
import type {
  CalDAVImportDependencies,
  ConnectedCalDAVCalendar,
} from "../../src/utils/caldav-calendar-import";

const WORK = { calendarUrl: "https://caldav.icloud.com/1/calendars/work/", name: "Work" };
const HOME = { calendarUrl: "https://caldav.icloud.com/1/calendars/home/", name: "Home" };
const TRIPS = { calendarUrl: "https://caldav.icloud.com/1/calendars/trips/", name: "Trips" };

interface FakeStore {
  accounts: string[];
  calendars: ConnectedCalDAVCalendar[];
  reusableAccountId: string | null;
  locks: number;
}

const createStore = (overrides: Partial<FakeStore> = {}): FakeStore => ({
  accounts: [],
  calendars: [],
  locks: 0,
  reusableAccountId: null,
  ...overrides,
});

const createDependencies = (
  store: FakeStore,
  accountLimit = 2,
): CalDAVImportDependencies => ({
  accountLimit,
  runInTransaction: (work) =>
    work({
      countAccounts: () => Promise.resolve(store.accounts.length),
      createAccount: () => {
        const accountId = `account-${store.accounts.length + 1}`;
        store.accounts.push(accountId);
        return Promise.resolve(accountId);
      },
      findConnectedCalendars: (accountId, calendarUrls) =>
        Promise.resolve(
          store.calendars.filter(
            (calendar) =>
              calendar.accountId === accountId && calendarUrls.includes(calendar.calendarUrl),
          ),
        ),
      findReusableAccountId: () => Promise.resolve(store.reusableAccountId),
      insertCalendars: (accountId, calendars) => {
        const inserted = calendars.map((calendar, index) => ({
          ...calendar,
          accountId,
          id: `calendar-${store.calendars.length + index + 1}`,
        }));
        store.calendars.push(...inserted);
        return Promise.resolve(inserted);
      },
      lockUserAccounts: () => {
        store.locks += 1;
        return Promise.resolve();
      },
    }),
});

describe("importCalDAVCalendarsWithDependencies", () => {
  it("imports the calendars that are new and reports the ones already connected", async () => {
    const store = createStore({
      accounts: ["account-1"],
      calendars: [{ ...WORK, accountId: "account-1", id: "calendar-1" }],
      reusableAccountId: "account-1",
    });

    const result = await importCalDAVCalendarsWithDependencies(
      [WORK, HOME, TRIPS],
      createDependencies(store),
    );

    expect(result.accountId).toBe("account-1");
    expect(result.calendars.map(({ calendarUrl, status }) => [calendarUrl, status])).toEqual([
      [WORK.calendarUrl, "already_connected"],
      [HOME.calendarUrl, "imported"],
      [TRIPS.calendarUrl, "imported"],
    ]);
    expect(store.calendars).toHaveLength(3);
    expect(store.accounts).toEqual(["account-1"]);
  });

  it("succeeds without writing anything when every calendar is already connected", async () => {
    const store = createStore({
      accounts: ["account-1", "account-2"],
      calendars: [
        { ...WORK, accountId: "account-2", id: "calendar-1" },
        { ...HOME, accountId: "account-2", id: "calendar-2" },
      ],
      reusableAccountId: "account-2",
    });

    const result = await importCalDAVCalendarsWithDependencies(
      [WORK, HOME],
      createDependencies(store, 2),
    );

    expect(result.accountId).toBe("account-2");
    expect(result.calendars.every(({ status }) => status === "already_connected")).toBe(true);
    expect(store.accounts).toHaveLength(2);
    expect(store.calendars).toHaveLength(2);
  });

  it("imports calendars a different account of the same server already holds at the same URLs", async () => {
    const store = createStore({
      accounts: ["account-1"],
      calendars: [{ ...WORK, accountId: "account-1", id: "calendar-1" }],
    });

    const result = await importCalDAVCalendarsWithDependencies(
      [WORK],
      createDependencies(store, 2),
    );

    expect(result.accountId).toBe("account-2");
    expect(result.calendars.map(({ accountId, status }) => [accountId, status])).toEqual([
      ["account-2", "imported"],
    ]);
    expect(store.calendars).toHaveLength(2);
  });

  it("imports the same selection twice without failing the second time", async () => {
    const store = createStore();
    const dependencies = createDependencies(store);

    const first = await importCalDAVCalendarsWithDependencies([WORK, HOME], dependencies);
    store.reusableAccountId = first.accountId;
    const second = await importCalDAVCalendarsWithDependencies([WORK, HOME], dependencies);

    expect(second.accountId).toBe(first.accountId);
    expect(second.calendars.map(({ status }) => status)).toEqual([
      "already_connected",
      "already_connected",
    ]);
    expect(store.calendars).toHaveLength(2);
  });

  it("creates one account for a first import and counts a repeated calendar once", async () => {
    const store = createStore();

    const result = await importCalDAVCalendarsWithDependencies(
      [WORK, WORK, HOME],
      createDependencies(store),
    );

    expect(store.accounts).toEqual([result.accountId]);
    expect(result.calendars.map(({ calendarUrl }) => calendarUrl)).toEqual([
      WORK.calendarUrl,
      HOME.calendarUrl,
    ]);
    expect(store.locks).toBe(1);
  });

  it("refuses a new account past the plan limit and writes nothing", async () => {
    const store = createStore({ accounts: ["account-1", "account-2"] });

    await expect(
      importCalDAVCalendarsWithDependencies([WORK], createDependencies(store, 2)),
    ).rejects.toBeInstanceOf(CalDAVSourceLimitError);

    expect(store.accounts).toHaveLength(2);
    expect(store.calendars).toHaveLength(0);
  });
});
