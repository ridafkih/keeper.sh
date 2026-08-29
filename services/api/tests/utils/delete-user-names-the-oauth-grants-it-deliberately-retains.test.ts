import { describe, expect, it, vi } from "vitest";
import type {
  TeardownResidueDraft,
  TeardownResidueRecord,
} from "@keeper.sh/calendar";

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

const runTeardown = async (grants: { provider: string }[]): Promise<void> => {
  const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");
  const tombstones = new Map<string, string>();

  await createDeleteUserSyncTeardown({
    createQueue: () => ({
      getJob: () => Promise.resolve({}),
      remove: () => Promise.resolve(0),
    }),
    deregisterPushChannels: () => Promise.resolve(0),
    listCalendarIds: () => Promise.resolve([]),
    listOAuthGrantProviders: () => Promise.resolve(grants),
    listPushChannels: () => Promise.resolve([]),
    redis: {
      del: (key: string) => Promise.resolve(Number(tombstones.delete(key))),
      exists: (key: string) => Promise.resolve(Number(tombstones.has(key))),
      set: (key: string, value: string) => {
        tombstones.set(key, value);

        return Promise.resolve("OK");
      },
    },
    residue: createResidueStore(),
  } as never)(DELETED_USER);
};

const retainedGrantFields = (): unknown[] =>
  loggedFields
    .filter((fields) => RETAINED_GRANTS_FIELD in fields)
    .map((fields) => fields[RETAINED_GRANTS_FIELD]);

describe("delete user names the oauth grants it deliberately retains", () => {
  it("names the sorted distinct providers whose grant survives the delete", async () => {
    loggedFields.length = 0;

    await runTeardown([
      { provider: "google" },
      { provider: "microsoft" },
      { provider: "google" },
    ]);

    expect(retainedGrantFields()).toEqual([["google", "microsoft"]]);
  });

  it("states an empty retained grant list for a user with no provider account", async () => {
    loggedFields.length = 0;

    await runTeardown([]);

    expect(retainedGrantFields()).toEqual([[]]);
  });
});
