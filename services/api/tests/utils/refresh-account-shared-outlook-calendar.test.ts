import { beforeEach, describe, expect, it, vi } from "vitest";

const CREDENTIAL_EMAIL = "connected@synthetic-tenant.test";
const COLLEAGUE_EMAIL = "colleague@synthetic-tenant.test";
const OWN_EXTERNAL_ID = "outlook-own-calendar";
const SHARED_EXTERNAL_ID = "outlook-shared-calendar";
const ONE_HOUR_IN_MS = 3_600_000;
const FIRST_SELECT = 1;
const NO_CHANGES = 0;

const harness = vi.hoisted(() => ({
  accountRows: [] as Record<string, unknown>[],
  calendarRows: [] as Record<string, unknown>[],
  selectCount: 0,
  updates: [] as Record<string, unknown>[],
}));

const createSelectBuilder = (rows: unknown[]): Record<string, unknown> => {
  const builder = Promise.resolve(rows) as unknown as Record<string, unknown>;
  builder.from = () => builder;
  builder.innerJoin = () => builder;
  builder.where = () => builder;
  builder.limit = () => builder;
  return builder;
};

vi.mock("@/context", () => {
  const database = {
    insert: () => {
      throw new Error("refresh inserted a calendar that already existed");
    },
    select: () => {
      harness.selectCount += 1;
      if (harness.selectCount === FIRST_SELECT) {
        return createSelectBuilder(harness.accountRows);
      }
      return createSelectBuilder(harness.calendarRows);
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        harness.updates.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
  };

  return { database };
});

const { refreshAccountCalendars } = await import("../../src/utils/refresh-account-calendars");

const graphCalendarListBody = {
  value: [
    {
      canEdit: true,
      id: OWN_EXTERNAL_ID,
      isDefaultCalendar: true,
      name: "Own Calendar",
      owner: { address: CREDENTIAL_EMAIL, name: "Connected User" },
    },
    {
      canEdit: true,
      id: SHARED_EXTERNAL_ID,
      isDefaultCalendar: false,
      name: "Team Planning",
      owner: { address: COLLEAGUE_EMAIL, name: "Colleague" },
    },
  ],
};

describe("refreshAccountCalendars with an Outlook calendar shared by another mailbox", () => {
  beforeEach(() => {
    harness.selectCount = 0;
    harness.updates = [];
    harness.accountRows = [{
      accessToken: "access-token",
      email: CREDENTIAL_EMAIL,
      expiresAt: new Date(Date.now() + ONE_HOUR_IN_MS),
      provider: "outlook",
      refreshToken: "refresh-token",
    }];
    harness.calendarRows = [
      {
        externalCalendarId: OWN_EXTERNAL_ID,
        id: "calendar-own",
        providerMissingSince: null,
      },
      {
        externalCalendarId: SHARED_EXTERNAL_ID,
        id: "calendar-shared",
        providerMissingSince: null,
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json(graphCalendarListBody))),
    );
  });

  it("leaves the shared calendar untouched instead of flagging it as missing at the provider", async () => {
    const result = await refreshAccountCalendars("user-1", "account-1");

    expect(harness.updates).toEqual([]);
    expect(result.missing).toBe(NO_CHANGES);
    expect(result.imported).toBe(NO_CHANGES);
    expect(result.restored).toBe(NO_CHANGES);
  });
});
