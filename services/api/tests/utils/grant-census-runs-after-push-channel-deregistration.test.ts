import { describe, expect, it, vi } from "vitest";
import type {
  TeardownResidueDraft,
  TeardownResidueRecord,
} from "@keeper.sh/calendar";
import type { TeardownPushChannel } from "@/utils/push-notifications/deregister-account-channels";

vi.mock("@/utils/logging", () => ({
  context: (run: () => unknown) => run(),
  destroy: () => Promise.resolve(),
  widelog: {
    error: () => null,
    errorFields: () => null,
    set: () => null,
    setFields: () => null,
  },
}));

const DELETED_USER = "user-A";

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

const dialableChannel = (): TeardownPushChannel => ({
  credential: { accessToken: "token", expiresAt: null, refreshToken: null },
  provider: "google",
  providerChannelId: "google-channel-1",
  providerResourceId: "resource-1",
  userId: DELETED_USER,
});

describe("grant census runs after push channel deregistration", () => {
  it("deregisters live push channels even when the retained grant query rejects", async () => {
    const deregisterCalls: string[] = [];
    const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");
    const tombstones = new Map<string, string>();

    await createDeleteUserSyncTeardown({
      createQueue: () => ({
        getJob: () => Promise.resolve({}),
        remove: () => Promise.resolve(0),
      }),
      deregisterPushChannels: (userId: string) => {
        deregisterCalls.push(userId);

        return Promise.resolve(1);
      },
      listCalendarIds: () => Promise.resolve([]),
      listOAuthGrantProviders: () => Promise.reject(new Error("connection pool exhausted")),
      listPushChannels: () => Promise.resolve([dialableChannel()]),
      redis: {
        del: (key: string) => Promise.resolve(Number(tombstones.delete(key))),
        exists: (key: string) => Promise.resolve(Number(tombstones.has(key))),
        set: (key: string, value: string) => {
          tombstones.set(key, value);

          return Promise.resolve("OK");
        },
      },
      residue: createResidueStore(),
    } as never)(DELETED_USER).catch(() => {});

    expect(deregisterCalls).toEqual([DELETED_USER]);
  });
});
