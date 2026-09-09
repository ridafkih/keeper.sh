import { describe, expect, it, vi } from "vitest";

import {
  applyCalDAVReconnect,
  getCalDAVReconnectTarget,
  ReconnectNotSupportedError,
} from "../../src/utils/reconnect-account";
import type { KeeperDatabase } from "../../src/types";

/* @/context boots auth on import, which a unit test has no way to satisfy. */
vi.mock("../../src/context", () => ({
  encryptionKey: "0".repeat(44),
}));
vi.mock("@keeper.sh/database", () => ({
  encryptPassword: (password: string) => `encrypted:${password}`,
}));

const USER_ID = "user-1";
const ACCOUNT_ID = "019c0000-0000-7000-8000-000000000001";

interface AccountRow {
  accountId: string;
  authType: string;
  credentialId: string;
  serverUrl: string;
  username: string;
}

const createMockDatabase = (rows: AccountRow[]) =>
  ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () => Promise.resolve(rows),
          }),
        }),
      }),
    }),
  }) as unknown as KeeperDatabase;

const caldavRow: AccountRow = {
  accountId: ACCOUNT_ID,
  authType: "caldav",
  credentialId: "019c0000-0000-7000-8000-000000000002",
  serverUrl: "https://caldav.example.invalid/",
  username: "person@example.invalid",
};

describe("getCalDAVReconnectTarget", () => {
  it("returns the stored server and username to repair", async () => {
    const target = await getCalDAVReconnectTarget(
      createMockDatabase([caldavRow]),
      USER_ID,
      ACCOUNT_ID,
    );

    expect(target).toEqual({
      accountId: ACCOUNT_ID,
      credentialId: caldavRow.credentialId,
      serverUrl: caldavRow.serverUrl,
      username: caldavRow.username,
    });
  });

  it("returns null when the account is not the user's", async () => {
    const target = await getCalDAVReconnectTarget(createMockDatabase([]), USER_ID, ACCOUNT_ID);

    expect(target).toBeNull();
  });

  it("refuses an OAuth account, which recovers through the provider instead", async () => {
    const database = createMockDatabase([{ ...caldavRow, authType: "oauth" }]);

    await expect(
      getCalDAVReconnectTarget(database, USER_ID, ACCOUNT_ID),
    ).rejects.toBeInstanceOf(ReconnectNotSupportedError);
  });
});

describe("applyCalDAVReconnect", () => {
  it("clears the demand in the same transaction that stores the password", async () => {
    const updates: Record<string, unknown>[] = [];
    const database = {
      transaction: (run: (tx: unknown) => Promise<unknown>) =>
        run({
          update: () => ({
            set: (values: Record<string, unknown>) => {
              updates.push(values);
              return { where: () => Promise.resolve() };
            },
          }),
        }),
    } as unknown as KeeperDatabase;

    await applyCalDAVReconnect(
      database,
      {
        accountId: ACCOUNT_ID,
        credentialId: caldavRow.credentialId,
        serverUrl: caldavRow.serverUrl,
        username: caldavRow.username,
      },
      "new-app-password",
      "basic",
    );

    // A stored password that leaves the account flagged would keep every warning surface lit.
    expect(updates.some((values) => "encryptedPassword" in values)).toBe(true);
    expect(updates).toContainEqual({
      needsReauthentication: false,
      reauthenticationSource: null,
    });
  });
});
