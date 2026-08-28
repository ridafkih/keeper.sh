import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { createOAuthSourceCredential as createOAuthSourceCredentialFn } from "../../src/utils/oauth-source-credentials";

let createOAuthSourceCredential: typeof createOAuthSourceCredentialFn = () =>
  Promise.reject(new Error("Module not loaded"));

let existingRows: Array<{ id: string }> = [];
let updateOutcomes: Array<{ command: string; count: number }> = [];
let insertedValues: Array<Record<string, unknown>> = [];
let createdCredentialIds: string[] = [];

const INSERTED_CREDENTIAL_ID = "31d8f0b6-b6c6-4a3f-9b4f-2f0a4a1c9d55";
const VANISHED_CREDENTIAL_ID = "4b0922d6-0f0a-4b1a-9f4a-0b3f5c6d7e8f";

interface SelectChain {
  from: () => SelectChain;
  where: () => SelectChain;
  limit: () => Promise<Array<{ id: string }>>;
}

const createSelectBuilder = (): SelectChain => {
  const chain: SelectChain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(existingRows),
  };
  return chain;
};

const createUpdateBuilder = () => ({
  set: () => ({
    where: () =>
      Promise.resolve(updateOutcomes.shift() ?? { command: "UPDATE", count: 1 }),
  }),
});

const createInsertBuilder = () => ({
  values: (values: Record<string, unknown>) => {
    insertedValues.push(values);
    return {
      returning: () => Promise.resolve([{ id: INSERTED_CREDENTIAL_ID }]),
    };
  },
});

beforeAll(async () => {
  vi.mock("../../src/env", () => ({
    default: {},
    schema: {},
  }));

  vi.mock("../../src/context", () => ({
    database: {
      insert: () => createInsertBuilder(),
      select: () => createSelectBuilder(),
      update: () => createUpdateBuilder(),
    },
  }));

  ({ createOAuthSourceCredential } = await import("../../src/utils/oauth-source-credentials"));
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  existingRows = [{ id: VANISHED_CREDENTIAL_ID }];
  updateOutcomes = [{ command: "UPDATE", count: 0 }];
  insertedValues = [];
  createdCredentialIds = [];
});

const connect = () =>
  createOAuthSourceCredential(
    "user-1",
    {
      accessToken: "fresh-access-token",
      email: "person@example.com",
      expiresAt: new Date("2026-08-28T00:00:00.000Z"),
      provider: "google",
      refreshToken: "fresh-refresh-token",
    },
    {
      onCredentialCreated: (credentialId: string) => {
        createdCredentialIds.push(credentialId);
      },
    },
  );

describe("A credential adoption update that touched no row reissues the grant", () => {
  it("inserts a new credential row when the adoption update matched nothing", async () => {
    await connect();

    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({
      accessToken: "fresh-access-token",
      email: "person@example.com",
      provider: "google",
      refreshToken: "fresh-refresh-token",
      userId: "user-1",
    });
  });

  it("returns the inserted credential id rather than the vanished one", async () => {
    const credentialId = await connect();

    expect(credentialId).toBe(INSERTED_CREDENTIAL_ID);
    expect(credentialId).not.toBe(VANISHED_CREDENTIAL_ID);
  });

  it("arms the discard path by announcing the newly created credential", async () => {
    await connect();

    expect(createdCredentialIds).toEqual([INSERTED_CREDENTIAL_ID]);
  });

  it("still adopts in place when the update actually matched the existing row", async () => {
    updateOutcomes = [{ command: "UPDATE", count: 1 }];

    const credentialId = await connect();

    expect(credentialId).toBe(VANISHED_CREDENTIAL_ID);
    expect(insertedValues).toEqual([]);
    expect(createdCredentialIds).toEqual([]);
  });
});
