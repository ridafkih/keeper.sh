import { describe, expect, it, vi } from "vitest";
import { OAUTH_GRANT_RESIDUE_KIND } from "@keeper.sh/calendar";
import type {
  TeardownResidueDraft,
  TeardownResidueRecord,
} from "@keeper.sh/calendar";
import type { DeleteUserOAuthCredential } from "@/utils/delete-user-teardown";

const loggedFields: Record<string, unknown>[] = [];

vi.mock("@/utils/logging", () => ({
  context: (run: () => unknown) => run(),
  destroy: () => Promise.resolve(),
  widelog: {
    error: () => null,
    errorFields: () => null,
    set: (key: string, value: unknown) => {
      loggedFields.push({ [key]: value });
    },
    setFields: (fields: Record<string, unknown>) => {
      loggedFields.push(fields);
    },
  },
}));

const DELETED_USER = "user-A";
const RETAINED_GRANTS_FIELD = "delete_user.oauth_grants_retained";
const RECORDED_GRANTS_FIELD = "delete_user.oauth_grants_recorded";

const createResidueStore = (): {
  delete: (userId: string, kind: string, providerChannelId: string) => Promise<number>;
  deleteForUser: (userId: string, kind: string) => Promise<number>;
  list: () => Promise<TeardownResidueRecord[]>;
  record: (draft: TeardownResidueDraft) => Promise<void>;
} => {
  const rows: TeardownResidueRecord[] = [];

  return {
    delete: () => Promise.resolve(0),
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([...rows]),
    record: (draft) => {
      rows.push({ ...draft, id: `residue-${rows.length + 1}` } as TeardownResidueRecord);

      return Promise.resolve();
    },
  };
};

const credentialFor = (provider: string, index: number): DeleteUserOAuthCredential => ({
  accessToken: `access-${index}`,
  accountId: `credential-${index}`,
  email: `owner-${index}@example.test`,
  expiresAt: null,
  provider,
  providerAccountId: `${provider}-account-${index}`,
  refreshToken: `refresh-${index}`,
  userId: DELETED_USER,
});

const runTeardown = async (
  providers: string[],
): Promise<TeardownResidueRecord[]> => {
  const grants = providers.map((provider, index) => credentialFor(provider, index));
  const residue = createResidueStore();
  const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");
  const tombstones = new Map<string, string>();

  await createDeleteUserSyncTeardown({
    createQueue: () => ({
      getJob: () => Promise.resolve({}),
      remove: () => Promise.resolve(0),
    }),
    deregisterPushChannels: () => Promise.resolve(0),
    listCalendarIds: () => Promise.resolve([]),
    listOAuthCredentials: () => Promise.resolve(grants),
    listPushChannels: () => Promise.resolve([]),
    redis: {
      del: (key: string) => Promise.resolve(Number(tombstones.delete(key))),
      exists: (key: string) => Promise.resolve(Number(tombstones.has(key))),
      set: (key: string, value: string) => {
        tombstones.set(key, value);

        return Promise.resolve("OK");
      },
    },
    residue,
  } as never)(DELETED_USER);

  return await residue.list();
};

const retainedGrantFields = (): unknown[] =>
  loggedFields
    .filter((fields) => RETAINED_GRANTS_FIELD in fields)
    .map((fields) => fields[RETAINED_GRANTS_FIELD]);

const recordedGrantCounts = (): unknown[] =>
  loggedFields
    .filter((fields) => RECORDED_GRANTS_FIELD in fields)
    .map((fields) => fields[RECORDED_GRANTS_FIELD]);

describe("delete user records the oauth grants it deliberately retains", () => {
  it("names the sorted distinct providers whose grant survives the delete", async () => {
    loggedFields.length = 0;

    await runTeardown(["google", "microsoft", "google"]);

    expect(retainedGrantFields()).toEqual([["google", "microsoft"]]);
  });

  it("leaves revocable grant residue naming the credential the reaper must revoke", async () => {
    loggedFields.length = 0;

    const residue = await runTeardown(["google", "microsoft", "google"]);

    expect(
      residue.map((row) => ({
        accountEmail: row.accountEmail,
        externalId: row.externalId,
        kind: row.kind,
        provider: row.provider,
        providerAccountId: row.providerAccountId,
      })),
    ).toEqual([
      {
        accountEmail: "owner-0@example.test",
        externalId: "credential-0",
        kind: OAUTH_GRANT_RESIDUE_KIND,
        provider: "google",
        providerAccountId: "google-account-0",
      },
      {
        accountEmail: "owner-2@example.test",
        externalId: "credential-2",
        kind: OAUTH_GRANT_RESIDUE_KIND,
        provider: "google",
        providerAccountId: "google-account-2",
      },
    ]);
    expect(recordedGrantCounts()).toEqual([2]);
  });

  it("states an empty retained grant list for a user with no provider account", async () => {
    loggedFields.length = 0;

    const residue = await runTeardown([]);

    expect(retainedGrantFields()).toEqual([[]]);
    expect(residue).toEqual([]);
    expect(recordedGrantCounts()).toEqual([0]);
  });
});
