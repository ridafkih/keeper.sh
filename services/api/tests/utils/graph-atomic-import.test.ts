import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
const state = vi.hoisted(() => ({
  credential: { accessToken: "old", refreshToken: "old-refresh", microsoftScope: "old-scope" } as Record<string, unknown>,
  calendars: [] as unknown[], listed: vi.fn(), jobs: vi.fn(), failInsert: false, failFinalUpdate: false, inTransaction: false,
}));
vi.mock("@keeper.sh/calendar/outlook", () => ({ listUserCalendars: state.listed }));
vi.mock("@/utils/background-task", () => ({ spawnBackgroundJob: (...args: unknown[]) => {
  expect(state.inTransaction).toBe(false);
  state.jobs(...args);
} }));
vi.mock("@/utils/source-calendar-insert", () => ({
  createSourceCalendarInsertDependencies: (tx: unknown) => tx,
  insertSourceCalendars: (_tx: unknown, _user: string, calendars: unknown[]) => {
    expect(state.inTransaction).toBe(true);
    state.calendars.push(...calendars);
    if (state.failInsert) {return Promise.reject(new Error("Calendar insert failed"));}
    return Promise.resolve();
  },
}));
vi.mock("@/context", () => ({
  premiumService: { getUserPlan: () => Promise.resolve("free"), getAccountLimit: () => 5 },
  database: {
    select: () => { throw new Error("Write flow used global database"); },
    transaction: async (action: (tx: unknown) => Promise<unknown>) => {
      const before = structuredClone({ credential: state.credential, calendars: state.calendars });
      state.inTransaction = true;
      const tx = {
        execute: () => Promise.resolve(),
        select: () => ({ from: (table: never) => {
          const name = getTableName(table);
          const rows: { id: string }[] = [];
          if (name === "oauth_credentials") { rows.push({ id: "credential" }); }
          if (name === "calendar_accounts") { rows.push({ id: "account" }); }
          const result = Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
          return { where: () => result };
        } }),
        update: (table: never) => ({ set: (values: Record<string, unknown>) => ({ where: () => {
          if (getTableName(table) === "oauth_credentials") {Object.assign(state.credential, values);}
          if (state.failFinalUpdate && "needsReauthentication" in values && getTableName(table) === "calendar_accounts") {return Promise.reject(new Error("Final write failed"));}
          return Promise.resolve();
        } }) }),
      };
      try { return await action(tx); }
      catch (error) { state.credential = before.credential; state.calendars = before.calendars; throw error; }
      finally { state.inTransaction = false; }
    },
  },
}));
const { importOAuthAccountCalendars } = await import("@/utils/oauth-sources");
const options = { userId: "user", provider: "outlook", providerAccountId: "ms-user", email: "user@example.test", accessToken: "new" };
const credentials = { provider: "outlook", email: options.email, accessToken: "new", refreshToken: "new-refresh", expiresAt: new Date(), microsoftClientId: "11111111-1111-4111-8111-111111111111", microsoftTenant: "organizations", microsoftScope: "openid profile offline_access" };
beforeEach(() => {
  state.credential = { accessToken: "old", refreshToken: "old-refresh", microsoftScope: "old-scope" };
  state.calendars = []; state.failInsert = false; state.failFinalUpdate = false; state.inTransaction = false;
  vi.clearAllMocks();
  state.listed.mockImplementation(() => { expect(state.inTransaction).toBe(false); return Promise.resolve([{ id: "calendar", name: "Calendar" }]); });
});
describe("atomic Graph credential and calendar import", () => {
  it("does not replace credentials on calendar authorization failure", async () => {
    state.listed.mockRejectedValue(Object.assign(new Error("Denied"), { authRequired: true }));
    await expect(importOAuthAccountCalendars(options, credentials)).rejects.toThrow("Denied");
    expect(state.credential.accessToken).toBe("old");
    expect(state.jobs).not.toHaveBeenCalled();
  });
  it.each(["failInsert", "failFinalUpdate"] as const)("rolls back credentials and calendars after %s", async (failure) => {
    state[failure] = true;
    await expect(importOAuthAccountCalendars(options, credentials)).rejects.toThrow();
    expect(state.credential).toEqual({ accessToken: "old", refreshToken: "old-refresh", microsoftScope: "old-scope" });
    expect(state.calendars).toEqual([]);
    expect(state.jobs).not.toHaveBeenCalled();
  });
  it("commits custom scopes and starts jobs only after commit", async () => {
    expect(await importOAuthAccountCalendars(options, credentials)).toBe("account");
    expect(state.credential).toMatchObject({ accessToken: credentials.accessToken, refreshToken: credentials.refreshToken, microsoftClientId: credentials.microsoftClientId, microsoftTenant: credentials.microsoftTenant, microsoftScope: credentials.microsoftScope });
    expect(state.calendars).toHaveLength(1);
    expect(state.jobs).toHaveBeenCalledTimes(2);
  });
});
