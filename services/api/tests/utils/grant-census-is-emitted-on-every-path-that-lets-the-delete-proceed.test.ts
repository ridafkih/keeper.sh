import { describe, expect, it, vi } from "vitest";
import type {
  TeardownResidueDraft,
  TeardownResidueRecord,
} from "@keeper.sh/calendar";
import type { TeardownPushChannel } from "@/utils/push-notifications/deregister-account-channels";

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
const STOPPED_CHANNEL_ID = "google-channel-1";

const createResidueStore = (): {
  clear: (id: string) => Promise<void>;
  delete: (userId: string, kind: string, providerChannelId: string) => Promise<number>;
  deleteForUser: (userId: string, kind: string) => Promise<number>;
  list: () => Promise<TeardownResidueRecord[]>;
  record: (draft: TeardownResidueDraft) => Promise<void>;
} => {
  const recorded: TeardownResidueRecord[] = [];

  return {
    clear: () => Promise.resolve(),
    delete: () => Promise.resolve(1),
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([...recorded]),
    record: (draft) => {
      recorded.push({ ...draft, id: `residue-${recorded.length + 1}` } as TeardownResidueRecord);

      return Promise.resolve();
    },
  };
};

const dialableChannel = (): TeardownPushChannel => ({
  credential: { accessToken: "token", expiresAt: null, refreshToken: null },
  provider: "google",
  providerChannelId: STOPPED_CHANNEL_ID,
  providerResourceId: "resource-1",
  userId: DELETED_USER,
});

const censusValues = (): unknown[] =>
  loggedFields
    .filter((fields) => RETAINED_GRANTS_FIELD in fields)
    .map((fields) => fields[RETAINED_GRANTS_FIELD]);

const namesRetainedGrants = (census: unknown[]): boolean =>
  census.length === 1
  && (census[0] === "unavailable"
    || (Array.isArray(census[0])
      && census[0].length === 1
      && census[0][0] === "google"));

const runTeardown = async (
  deregisterPushChannels: () => Promise<number>,
): Promise<{ censusCalls: number; census: unknown[]; resolved: boolean }> => {
  loggedFields.length = 0;

  const tombstones = new Map<string, string>();
  let censusCalls = 0;
  const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");

  const teardown = createDeleteUserSyncTeardown({
    createQueue: () => ({
      getJob: () => Promise.resolve({}),
      remove: () => Promise.resolve(0),
    }),
    deregisterPushChannels,
    listCalendarIds: () => Promise.resolve([]),
    listOAuthCredentials: () => {
      censusCalls += 1;

      return Promise.resolve([
        {
          accessToken: "access-token",
          accountId: "credential-1",
          email: "owner@example.test",
          expiresAt: null,
          provider: "google",
          providerAccountId: "google-account-1",
          refreshToken: "refresh-token",
          userId: DELETED_USER,
        },
      ]);
    },
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
  } as never);

  await teardown(DELETED_USER);

  return { census: censusValues(), censusCalls, resolved: true };
};

describe("grant census is emitted on every path that lets the delete proceed", () => {
  it("names the retained grants when deregistration fails outright and the delete still proceeds", async () => {
    const outcome = await runTeardown(() =>
      Promise.reject(new Error("provider unreachable")),
    );

    expect({
      namesRetainedGrants: namesRetainedGrants(outcome.census),
      observedCensus: outcome.census,
      resolved: outcome.resolved,
    }).toEqual({
      namesRetainedGrants: true,
      observedCensus: expect.any(Array),
      resolved: true,
    });
  });

  it("names the retained grants when the push channel step blows its deadline and the delete still proceeds", async () => {
    const outcome = await runTeardown(() => new Promise<number>(() => {}));

    expect({
      namesRetainedGrants: namesRetainedGrants(outcome.census),
      observedCensus: outcome.census,
      resolved: outcome.resolved,
    }).toEqual({
      namesRetainedGrants: true,
      observedCensus: expect.any(Array),
      resolved: true,
    });
  }, 15_000);
});
