import {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "5f7a1b2c-3d4e-4f50-8a1b-2c3d4e5f6071";
const ACCOUNT_ID = "6a8b2c3d-4e5f-4061-9b2c-3d4e5f607182";
const CREDENTIAL_ID = "7b9c3d4e-5f60-4172-ac3d-4e5f60718293";
const SOURCE_ID = "8cad4e5f-6071-4283-bd4e-5f6071829304";
const SERVER_URL = "https://caldav.icloud.com";
const USERNAME = "person@example.com";

interface RecordedWrite {
  table: string;
  values: Record<string, unknown>;
}

const tableNames = new Map<unknown, string>([
  [caldavCredentialsTable, "caldav_credentials"],
  [calendarAccountsTable, "calendar_accounts"],
  [calendarsTable, "calendars"],
]);

const resolveTableName = (table: unknown): string => {
  const name = tableNames.get(table);
  if (!name) {
    throw new Error("Unexpected table in CalDAV source flow");
  }
  return name;
};

const state: {
  existingSource: boolean;
  inserts: RecordedWrite[];
  reusableAccount: { id: string; caldavCredentialId: string } | null;
  updates: RecordedWrite[];
} = {
  existingSource: false,
  inserts: [],
  reusableAccount: null,
  updates: [],
};

const buildSelectChain = (rows: unknown[]) => {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) }),
    limit: () => Promise.resolve(rows),
  };
  return chain;
};

const reusableAccountRows = (): unknown[] => {
  if (!state.reusableAccount) {
    return [];
  }
  return [state.reusableAccount];
};

const createTransactionClient = () => ({
  execute: () => Promise.resolve(),
  select: (columns: Record<string, unknown>) => {
    if ("caldavCredentialId" in columns) {
      return buildSelectChain(reusableAccountRows());
    }
    if (state.existingSource && "id" in columns) {
      return buildSelectChain([{ accountId: ACCOUNT_ID, id: SOURCE_ID }]);
    }
    return buildSelectChain([]);
  },
  selectDistinct: () => buildSelectChain([]),
  insert: (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      state.inserts.push({ table: resolveTableName(table), values });
      return {
        returning: () => Promise.resolve([{
          createdAt: new Date("2026-08-12T09:00:00.000Z"),
          id: SOURCE_ID,
          name: values.name,
          userId: USER_ID,
        }]),
      };
    },
  }),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => {
      state.updates.push({ table: resolveTableName(table), values });
      const result = Promise.resolve([]);
      return { where: () => Object.assign(result, { returning: () => result }) };
    },
  }),
});

vi.mock("@/context", () => ({
  database: {
    transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      callback(createTransactionClient()),
  },
  encryptionKey: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  premiumService: {
    getAccountLimit: () => 5,
    getUserPlan: () => Promise.resolve("pro"),
  },
}));

vi.mock("@/utils/enqueue-push-sync", () => ({
  enqueuePushSync: () => Promise.resolve(),
}));

const { createCalDAVSource, DuplicateCalDAVSourceError } = await import("@/utils/caldav-sources");

const reconnectPayload = {
  authMethod: "basic",
  calendarUrl: "https://caldav.icloud.com/1234/calendars/work/",
  name: "Work",
  password: "fresh-app-specific-password",
  provider: "icloud",
  serverUrl: SERVER_URL,
  username: USERNAME,
};

describe("re-adding a CalDAV source after its password was revoked", () => {
  beforeEach(() => {
    state.existingSource = false;
    state.inserts = [];
    state.reusableAccount = { caldavCredentialId: CREDENTIAL_ID, id: ACCOUNT_ID };
    state.updates = [];
  });

  it("stores the freshly supplied password on the reused credential", async () => {
    await createCalDAVSource(USER_ID, reconnectPayload);

    expect(state.updates.map(({ table }) => table)).toContain("caldav_credentials");
  });

  it("clears the sticky reauthentication marker on the reused account", async () => {
    await createCalDAVSource(USER_ID, reconnectPayload);

    const accountWrite = state.updates.find(({ table }) => table === "calendar_accounts");
    expect(accountWrite?.values).toMatchObject({ needsReauthentication: false });
  });

  it("clears the ingest backoff so the account resumes on the next tick", async () => {
    await createCalDAVSource(USER_ID, reconnectPayload);

    const calendarWrite = state.updates.find(({ table }) => table === "calendars");
    expect(calendarWrite?.values).toMatchObject({
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    });
  });
});

describe("re-adding a CalDAV source that is already connected", () => {
  beforeEach(() => {
    state.existingSource = true;
    state.inserts = [];
    state.reusableAccount = { caldavCredentialId: CREDENTIAL_ID, id: ACCOUNT_ID };
    state.updates = [];
  });

  it("reports the reconnect as a success against the existing source", async () => {
    const result = await createCalDAVSource(USER_ID, reconnectPayload);

    expect(result).toMatchObject({
      reconnected: true,
      source: { accountId: ACCOUNT_ID, id: SOURCE_ID, userId: USER_ID },
    });
  });

  it("rotates the credential and clears the backoff without inserting a duplicate", async () => {
    await createCalDAVSource(USER_ID, reconnectPayload);

    expect(state.updates.map(({ table }) => table)).toEqual([
      "caldav_credentials",
      "calendar_accounts",
      "calendars",
    ]);
    expect(state.inserts).toEqual([]);
  });
});

describe("re-adding a calendar already connected through a different account", () => {
  beforeEach(() => {
    state.existingSource = true;
    state.inserts = [];
    state.reusableAccount = null;
    state.updates = [];
  });

  it("still reports the duplicate, because no credential was rotated", async () => {
    await expect(createCalDAVSource(USER_ID, reconnectPayload))
      .rejects.toBeInstanceOf(DuplicateCalDAVSourceError);
  });

  it("writes nothing when it reports the duplicate", async () => {
    await createCalDAVSource(USER_ID, reconnectPayload).catch(() => null);

    expect(state.updates).toEqual([]);
    expect(state.inserts).toEqual([]);
  });
});
