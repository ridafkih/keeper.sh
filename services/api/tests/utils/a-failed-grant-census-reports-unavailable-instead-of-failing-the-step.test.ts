import { describe, expect, it, vi } from "vitest";
import type {
  TeardownResidueDraft,
  TeardownResidueRecord,
} from "@keeper.sh/calendar";
import type { TeardownPushChannel } from "@/utils/push-notifications/deregister-account-channels";

const loggedFields: Record<string, unknown>[] = [];
const loggedErrors: unknown[] = [];

vi.mock("@/utils/logging", () => ({
  context: (run: () => unknown) => run(),
  destroy: () => Promise.resolve(),
  widelog: {
    error: (error: unknown) => {
      loggedErrors.push(error);
    },
    errorFields: (error: unknown) => {
      loggedErrors.push(error);
    },
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
const STOPPED_CHANNEL_ID = "google-channel-1";
const CENSUS_FAILURE = "connection pool exhausted";

interface ResidueClearCall {
  kind: string;
  providerChannelId: string;
  userId: string;
}

const createResidueStore = (
  recorded: TeardownResidueRecord[],
  cleared: ResidueClearCall[],
): {
  clear: (id: string) => Promise<void>;
  delete: (userId: string, kind: string, providerChannelId: string) => Promise<number>;
  deleteForUser: (userId: string, kind: string) => Promise<number>;
  list: () => Promise<TeardownResidueRecord[]>;
  record: (draft: TeardownResidueDraft) => Promise<void>;
} => ({
  clear: () => Promise.resolve(),
  delete: (userId, kind, providerChannelId) => {
    cleared.push({ kind, providerChannelId, userId });

    return Promise.resolve(1);
  },
  deleteForUser: () => Promise.resolve(0),
  list: () => Promise.resolve([...recorded]),
  record: (draft) => {
    recorded.push({
      ...draft,
      id: `residue-${recorded.length + 1}`,
    } as TeardownResidueRecord);

    return Promise.resolve();
  },
});

const dialableChannel = (): TeardownPushChannel => ({
  credential: { accessToken: "token", expiresAt: null, refreshToken: null },
  provider: "google",
  providerChannelId: STOPPED_CHANNEL_ID,
  providerResourceId: "resource-1",
  userId: DELETED_USER,
});

const retainedGrantFields = (): unknown[] =>
  loggedFields
    .filter((fields) => RETAINED_GRANTS_FIELD in fields)
    .map((fields) => fields[RETAINED_GRANTS_FIELD]);

describe("a failed grant census reports unavailable instead of failing the step", () => {
  it("finishes the teardown, clears stopped residue, and states the census is unavailable", async () => {
    loggedFields.length = 0;
    loggedErrors.length = 0;

    const deregisterCalls: string[] = [];
    const recorded: TeardownResidueRecord[] = [];
    const cleared: ResidueClearCall[] = [];
    const tombstones = new Map<string, string>();
    const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");

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
      listOAuthGrantProviders: () => Promise.reject(new Error(CENSUS_FAILURE)),
      listPushChannels: () => Promise.resolve([dialableChannel()]),
      redis: {
        del: (key: string) => Promise.resolve(Number(tombstones.delete(key))),
        exists: (key: string) => Promise.resolve(Number(tombstones.has(key))),
        set: (key: string, value: string) => {
          tombstones.set(key, value);

          return Promise.resolve("OK");
        },
      },
      residue: createResidueStore(recorded, cleared),
    } as never)(DELETED_USER);

    expect(deregisterCalls).toEqual([DELETED_USER]);
    expect(recorded.map((row) => row.providerChannelId)).toEqual([STOPPED_CHANNEL_ID]);
    expect(cleared.map((call) => call.providerChannelId)).toEqual([STOPPED_CHANNEL_ID]);
    expect(retainedGrantFields()).toEqual(["unavailable"]);
    expect(
      loggedErrors.some(
        (error) => error instanceof Error && error.message.includes(CENSUS_FAILURE),
      ),
    ).toBe(true);
  });
});
