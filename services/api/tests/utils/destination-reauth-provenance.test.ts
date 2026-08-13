import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/context", () => ({
  database: {},
  oauthProviders: {
    getProvider: () => null,
    hasRequiredScopes: () => true,
    isOAuthProvider: () => true,
  },
}));

const { upsertAccountAndCalendarWithDatabase } = await import("../../src/utils/destinations");

interface RecordedInsert {
  values: Record<string, unknown>;
  conflictSet: Record<string, unknown> | null;
}

const inserts: RecordedInsert[] = [];

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

const createInsertQuery = (recorded: RecordedInsert, rows: unknown[]): unknown => {
  const chain: Record<string, unknown> = {};
  return new Proxy(chain, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown) =>
          Promise.resolve(rows).then(onFulfilled);
      }
      if (property === "onConflictDoUpdate") {
        return (config: { set: Record<string, unknown> }) => {
          recorded.conflictSet = config.set;
          return createInsertQuery(recorded, rows);
        };
      }
      return () => createInsertQuery(recorded, rows);
    },
  });
};

const createDatabase = (): Parameters<typeof upsertAccountAndCalendarWithDatabase>[0] => ({
  delete: () => createSelectQuery([]),
  insert: () => ({
    values: (values: Record<string, unknown>) => {
      const recorded: RecordedInsert = { conflictSet: null, values };
      inserts.push(recorded);
      return createInsertQuery(recorded, [{ id: `row-${String(inserts.length)}` }]);
    },
  }),
  select: () => createSelectQuery([]),
  selectDistinct: () => createSelectQuery([]),
  update: () => createSelectQuery([]),
} as unknown as Parameters<typeof upsertAccountAndCalendarWithDatabase>[0]);

const linkDestination = async (needsReauthentication: boolean): Promise<void> => {
  await upsertAccountAndCalendarWithDatabase(createDatabase(), {
    accountId: "external-account-1",
    email: "user@example.com",
    needsReauthentication,
    oauthCredentialId: "credential-1",
    provider: "google",
    userId: "user-1",
  });
};

const accountInsert = (): RecordedInsert => {
  const [recorded] = inserts;
  if (!recorded) {
    throw new Error("expected the account upsert to run");
  }
  return recorded;
};

describe("linking a calendar destination whose grant is missing write scopes", () => {
  beforeEach(() => {
    inserts.length = 0;
  });

  it("records that the destination grant raised the re-authentication demand", async () => {
    await linkDestination(true);

    expect(accountInsert().values.needsReauthentication).toBe(true);
    expect(accountInsert().values.reauthenticationSource).toBe("destination-grant");
  });

  it("records the same provenance when the account row already exists", async () => {
    await linkDestination(true);

    expect(accountInsert().conflictSet?.needsReauthentication).toBe(true);
    expect(accountInsert().conflictSet?.reauthenticationSource).toBe("destination-grant");
  });

  it("drops the provenance when the grant carries every required scope", async () => {
    await linkDestination(false);

    expect(accountInsert().values.reauthenticationSource).toBeNull();
    expect(accountInsert().conflictSet?.reauthenticationSource).toBeNull();
  });
});
