import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  setCalls: [] as [string, unknown][],
}));

vi.mock("@/utils/logging", () => ({
  context: (callback: () => unknown) => callback(),
  widelog: {
    errorFields: () => null,
    flush: () => null,
    set: (key: string, value: unknown) => {
      captured.setCalls.push([key, value]);
    },
    setFields: () => null,
    time: { measure: (_key: string, callback: () => unknown) => callback() },
  },
}));

vi.mock("@/context", () => ({
  database: {},
  oauthProviders: {
    getProvider: () => null,
    hasRequiredScopes: () => true,
    isOAuthProvider: () => true,
  },
}));

const destinationsModule = await import("../../src/utils/destinations");
const { saveCalendarDestinationWithDatabase, upsertAccountAndCalendarWithDatabase } = destinationsModule;

interface AccountRow {
  caldavCredentialId: string | null;
  id: string;
  needsReauthentication: boolean;
  oauthCredentialId: string | null;
  reauthenticationSource: string | null;
  userId: string;
}

const updates: Record<string, unknown>[] = [];
let existingAccountRow: AccountRow | null = null;

const createSelectQuery = (rows: unknown[]): unknown => {
  const chain: Record<string, unknown> = {};
  return new Proxy(chain, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown) =>
          Promise.resolve(rows).then(onFulfilled);
      }
      return () => createSelectQuery(rows);
    },
  });
};

const resolveSelect = (projection: Record<string, unknown>): unknown[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.has("oauthCredentialId") || keys.has("needsReauthentication")) {
    if (!existingAccountRow) {
      return [];
    }
    return [existingAccountRow];
  }
  return [];
};

const createInsertQuery = (rows: unknown[]): unknown => {
  const chain: Record<string, unknown> = {};
  return new Proxy(chain, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown) =>
          Promise.resolve(rows).then(onFulfilled);
      }
      return () => createInsertQuery(rows);
    },
  });
};

let insertSequence = 0;

const createDatabase = (): Parameters<typeof saveCalendarDestinationWithDatabase>[0] => ({
  delete: () => createSelectQuery([]),
  insert: () => ({
    values: () => {
      insertSequence += 1;
      return createInsertQuery([{ id: `row-${String(insertSequence)}` }]);
    },
  }),
  select: (projection: Record<string, unknown>) =>
    createSelectQuery(resolveSelect(projection)),
  selectDistinct: () => createSelectQuery([]),
  update: () => ({
    set: (values: Record<string, unknown>) => {
      updates.push(values);
      return createSelectQuery([]);
    },
  }),
} as unknown as Parameters<typeof saveCalendarDestinationWithDatabase>[0]);

const reauthFields = (): Record<string, unknown> =>
  Object.fromEntries(captured.setCalls.filter(([key]) =>
    key.startsWith("reauth.") || key === "provider.account_id"));

const relinkDestination = (needsReauthentication: boolean): Promise<void> =>
  saveCalendarDestinationWithDatabase(
    createDatabase(),
    "user-1",
    "google",
    "external-account-1",
    "user@example.com",
    "access-token",
    "refresh-token",
    new Date(Date.now() + 3_600_000),
    needsReauthentication,
  );

const linkFreshDestination = async (needsReauthentication: boolean): Promise<void> => {
  await upsertAccountAndCalendarWithDatabase(createDatabase(), {
    accountId: "external-account-1",
    email: "user@example.com",
    needsReauthentication,
    oauthCredentialId: "credential-1",
    provider: "google",
    userId: "user-1",
  });
};

describe("re-authentication demand telemetry on the destination grant path", () => {
  beforeEach(() => {
    captured.setCalls.length = 0;
    updates.length = 0;
    insertSequence = 0;
    existingAccountRow = null;
  });

  describe("re-linking an existing destination account", () => {
    it("logs a raise when the fresh grant is missing required scopes", async () => {
      existingAccountRow = {
        caldavCredentialId: null,
        id: "account-1",
        needsReauthentication: false,
        oauthCredentialId: "credential-1",
        reauthenticationSource: null,
        userId: "user-1",
      };

      await relinkDestination(true);

      expect(reauthFields()).toEqual({
        "provider.account_id": "account-1",
        "reauth.action": "raise",
        "reauth.previous": false,
        "reauth.provenance": "destination-grant",
        "reauth.signal": "grant-missing-scopes",
        "reauth.transitioned": true,
      });
    });

    it("logs a clear carrying the provenance the demand was raised under", async () => {
      existingAccountRow = {
        caldavCredentialId: null,
        id: "account-1",
        needsReauthentication: true,
        oauthCredentialId: "credential-1",
        reauthenticationSource: "token-refresh",
        userId: "user-1",
      };

      await relinkDestination(false);

      expect(reauthFields()).toEqual({
        "provider.account_id": "account-1",
        "reauth.action": "clear",
        "reauth.previous": true,
        "reauth.provenance": "destination-grant",
        "reauth.recorded_provenance": "token-refresh",
        "reauth.transitioned": true,
      });
    });

    it("distinguishes a no-op clear over an already-clear flag from a real transition", async () => {
      existingAccountRow = {
        caldavCredentialId: null,
        id: "account-1",
        needsReauthentication: false,
        oauthCredentialId: "credential-1",
        reauthenticationSource: null,
        userId: "user-1",
      };

      await relinkDestination(false);

      expect(reauthFields()).toEqual({
        "provider.account_id": "account-1",
        "reauth.action": "clear",
        "reauth.previous": false,
        "reauth.provenance": "destination-grant",
        "reauth.transitioned": false,
      });
    });
  });

  describe("linking a destination account for the first time", () => {
    it("logs a scope-deficient grant as a raise over a clear prior state", async () => {
      await linkFreshDestination(true);

      expect(reauthFields()).toEqual({
        "provider.account_id": "row-1",
        "reauth.action": "raise",
        "reauth.previous": false,
        "reauth.provenance": "destination-grant",
        "reauth.signal": "grant-missing-scopes",
        "reauth.transitioned": true,
      });
    });

    it("logs a fully-scoped grant as a no-op clear", async () => {
      await linkFreshDestination(false);

      expect(reauthFields()).toEqual({
        "provider.account_id": "row-1",
        "reauth.action": "clear",
        "reauth.previous": false,
        "reauth.provenance": "destination-grant",
        "reauth.transitioned": false,
      });
    });
  });
});
