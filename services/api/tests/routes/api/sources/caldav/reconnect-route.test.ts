import {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "2b6c8d90-1e3f-4a52-8c74-9d0e1f2a3b46";
const ACCOUNT_ID = "3c7d9e01-2f40-4b63-9d85-0e1f2a3b4c57";
const CREDENTIAL_ID = "4d8e0f12-3041-4c74-ae96-1f2a3b4c5d68";
const SOURCE_ID = "5e9f1023-4152-4d85-bfa7-2a3b4c5d6e79";
const SERVER_URL = "https://caldav.icloud.com";
const USERNAME = "person@example.com";
const CLIENT_ERROR_FLOOR = 400;

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
    throw new Error("Unexpected table in the CalDAV source flow");
  }
  return name;
};

const state: { updates: RecordedWrite[] } = { updates: [] };

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

const createTransactionClient = () => ({
  execute: () => Promise.resolve(),
  select: (columns: Record<string, unknown>) => {
    if ("caldavCredentialId" in columns) {
      return buildSelectChain([{ caldavCredentialId: CREDENTIAL_ID, id: ACCOUNT_ID }]);
    }
    return buildSelectChain([{ accountId: ACCOUNT_ID, id: SOURCE_ID }]);
  },
  selectDistinct: () => buildSelectChain([]),
  insert: () => {
    throw new Error("The reconnect flow must not insert a duplicate calendar");
  },
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

vi.mock("@/utils/middleware", () => ({
  withAuth: (handler: unknown) => handler,
  withWideEvent: (handler: unknown) => handler,
}));

vi.mock("@/utils/logging", () => ({
  widelog: {
    error: () => null,
    errorFields: () => null,
    set: () => null,
  },
}));

const { POST } = await import("@/routes/api/sources/caldav/index");

const reconnectBody = {
  authMethod: "basic",
  calendarUrl: "https://caldav.icloud.com/1234/calendars/work/",
  name: "Work",
  password: "regenerated-app-specific-password",
  provider: "icloud",
  serverUrl: SERVER_URL,
  username: USERNAME,
};

const postHandler = POST as unknown as (
  input: { request: Request; userId: string },
) => Promise<Response>;

const postReconnect = (): Promise<Response> => postHandler({
  request: new Request("https://api.keeper.sh/api/sources/caldav", {
    body: JSON.stringify(reconnectBody),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  }),
  userId: USER_ID,
});

describe("re-adding an already connected CalDAV calendar with a regenerated password", () => {
  beforeEach(() => {
    state.updates = [];
  });

  it("rotates the stored credential and clears the ingest backoff", async () => {
    await postReconnect();

    expect(state.updates.map(({ table }) => table)).toEqual([
      "caldav_credentials",
      "calendar_accounts",
      "calendars",
    ]);
    expect(state.updates[2]?.values).toMatchObject({
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
    });
  });

  it("does not answer with an error the client can only read as a failed reconnect", async () => {
    const response = await postReconnect();

    expect(response.status).toBeLessThan(CLIENT_ERROR_FLOOR);
  });
});
