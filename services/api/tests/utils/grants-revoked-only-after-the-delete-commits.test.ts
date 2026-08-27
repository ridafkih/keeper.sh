import { describe, expect, it, vi } from "vitest";

interface LoggedError {
  error: unknown;
  fields: Record<string, unknown>;
}

interface WideEventCapture {
  loggedErrors: LoggedError[];
  loggedFields: Record<string, unknown>[];
}

vi.mock("widelogger", () => {
  const loggedErrors: LoggedError[] = [];
  const loggedFields: Record<string, unknown>[] = [];

  return {
    startWideEventCapture: (): WideEventCapture => {
      loggedErrors.length = 0;
      loggedFields.length = 0;
      return { loggedErrors, loggedFields };
    },
    widelog: {
      error: (prefix: string, error: unknown) => {
        loggedErrors.push({ error, fields: { prefix } });
      },
      errorFields: (error: unknown, fields: Record<string, unknown>) => {
        loggedErrors.push({ error, fields });
      },
      errors: () => undefined,
      flush: () => undefined,
      set: (key: string, value: unknown) => {
        loggedFields.push({ [key]: value });
      },
      setFields: (fields: Record<string, unknown>) => {
        loggedFields.push(fields);
      },
    },
    widelogger: () => ({
      context: (run: () => unknown) => run(),
      destroy: () => Promise.resolve(),
    }),
  };
});

const startWideEventCapture = async (): Promise<WideEventCapture> => {
  const logging = (await import("widelogger")) as unknown as {
    startWideEventCapture: () => WideEventCapture;
  };

  return logging.startWideEventCapture();
};

const DELETED_USER = "user-deadlock";
const GOOGLE_ACCOUNT_COUNT = 6;
const PROVIDER_ROUND_TRIP_MS = 300;
const OAUTH_GRANT_KIND = "oauth_grant";
const PUSH_CHANNEL_KIND = "push_channel";
const DEADLOCK_MESSAGE = "deadlock detected (40P01)";
const DELETE_USER_URL = "https://keeper.sh/api/auth/delete-user";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const OK = 200;

type FetchInput = Parameters<typeof fetch>[0];

interface TeardownCredential {
  accessToken: string;
  accountId: string;
  email: string;
  provider: string;
  providerAccountId: string;
  refreshToken: string | null;
  userId: string;
}

interface ResidueRow {
  credential?: { accessToken: string; expiresAt: Date | null; refreshToken: string | null };
  expiresAt?: Date;
  externalId?: string;
  id: string;
  kind: string;
  provider?: string;
  providerAccountId?: string;
  providerChannelId?: string;
  userId: string;
}

const googleCredentials = (count: number): TeardownCredential[] =>
  Array.from({ length: count }, (_unused, index) => ({
    accessToken: `access-${index}`,
    accountId: `account-${index}`,
    email: `account-${index}@gmail.com`,
    provider: "google",
    providerAccountId: `provider-account-${index}`,
    refreshToken: `refresh-${index}`,
    userId: DELETED_USER,
  }));

const createResidueHarness = (seeded: Omit<ResidueRow, "id">[] = []) => {
  const rows = new Map<string, ResidueRow>(
    seeded.map((row, index) => [`seed-${index}`, { ...row, id: `seed-${index}` }]),
  );
  const issued = { count: 0 };

  const clear = (residueId: string): Promise<void> => {
    rows.delete(residueId);
    return Promise.resolve();
  };

  const record = (draft: Omit<ResidueRow, "id">): Promise<void> => {
    issued.count += 1;

    const id = `residue-${issued.count}`;

    rows.set(id, { ...draft, id });

    return Promise.resolve();
  };

  return {
    reaperStore: {
      clear,
      list: () => Promise.resolve([...rows.values()]),
      purgeOrphaned: () => Promise.resolve([]),
      record,
    },
    rowsOfKind: (kind: string, userId: string): ResidueRow[] =>
      [...rows.values()].filter((row) => row.kind === kind && row.userId === userId),
    store: {
      clear,
      deleteForUser: (userId: string, kind: string) => {
        const doomed = [...rows.values()].filter(
          (row) => row.userId === userId && row.kind === kind,
        );

        for (const row of doomed) {
          rows.delete(row.id);
        }

        return Promise.resolve(doomed.length);
      },
      list: () =>
        Promise.resolve([...rows.values()].filter((row) => row.kind === PUSH_CHANNEL_KIND)),
      record,
    },
  };
};

const createRedisHarness = () => {
  const keys = new Map<string, string>();

  return {
    has: (key: string) => keys.has(key),
    redis: {
      del: (key: string) => Promise.resolve(keys.delete(key) ? 1 : 0),
      exists: (key: string) => Promise.resolve(keys.has(key) ? 1 : 0),
      set: (key: string, value: string) => {
        keys.set(key, value);
        return Promise.resolve("OK");
      },
    },
  };
};

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

interface PostedRevocation {
  contentType: string;
  method: string;
  token: string;
  url: string;
}

const createRevokeEndpoint =
  (posted: PostedRevocation[], latencyMs: number) =>
  async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const body = await request.text();

    posted.push({
      contentType: request.headers.get("content-type") ?? "",
      method: request.method,
      token: new URLSearchParams(body).get("token") ?? "",
      url: request.url,
    });

    if (latencyMs > 0) {
      await sleep(latencyMs);
    }

    return new Response("", { status: OK });
  };

const createTeardownDependencies = (options: {
  credentials: TeardownCredential[];
  fetchImpl: typeof fetch;
  redis: ReturnType<typeof createRedisHarness>["redis"];
  residue: ReturnType<typeof createResidueHarness>["store"];
}) => ({
  createQueue: () => ({
    getJob: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(0),
  }),
  deregisterPushChannels: () => Promise.resolve(0),
  fetchImpl: options.fetchImpl,
  listCalendarIds: () => Promise.resolve([]),
  listOAuthCredentials: (userId: string) =>
    Promise.resolve(options.credentials.filter((row) => row.userId === userId)),
  listPushChannels: () => Promise.resolve([]),
  redis: options.redis,
  residue: options.residue,
});

const flattenFields = (loggedFields: Record<string, unknown>[]): Record<string, unknown> =>
  loggedFields.reduce((all, fields) => ({ ...all, ...fields }), {});

const tokensOf = (posted: PostedRevocation[]): string[] =>
  posted.map((entry) => entry.token).toSorted();

const refreshTokensOf = (credentials: TeardownCredential[]): string[] =>
  credentials.map((credential) => credential.refreshToken ?? "").toSorted();

describe("oauth grants are revoked only after the user row delete commits", () => {
  it("dials no provider before the delete and leaves no queued revocation when it fails", async () => {
    await startWideEventCapture();

    const { createDeleteUserSyncTeardown, createDeleteUserSyncTeardownRollback } = await import(
      "@/utils/delete-user-teardown"
    );
    const { createDeleteUserCompensationScope } = await import(
      "@keeper.sh/auth/src/delete-user-compensation"
    );
    const { deletedUserTombstoneKey } = await import("@keeper.sh/calendar");

    const posted: PostedRevocation[] = [];
    const residue = createResidueHarness();
    const redis = createRedisHarness();
    const dependencies = createTeardownDependencies({
      credentials: googleCredentials(GOOGLE_ACCOUNT_COUNT),
      fetchImpl: createRevokeEndpoint(posted, 0) as unknown as typeof fetch,
      redis: redis.redis,
      residue: residue.store,
    });

    const scope = createDeleteUserCompensationScope();
    const teardown = createDeleteUserSyncTeardown(dependencies as never);
    const queuedAtDeleteTime = { count: 0 };
    const handler = scope.withDeleteUserCompensation(
      async () => {
        scope.startDeleteUserAttempt(DELETED_USER);
        await teardown(DELETED_USER);

        queuedAtDeleteTime.count = residue.rowsOfKind(OAUTH_GRANT_KIND, DELETED_USER).length;

        throw new Error(DEADLOCK_MESSAGE);
      },
      {
        compensate: createDeleteUserSyncTeardownRollback(dependencies as never),
        finish: () => Promise.reject(new Error("the delete never committed")),
        prepare: () => Promise.resolve(),
        userRowExists: () => Promise.resolve(true),
      },
    );

    await expect(handler(new Request(DELETE_USER_URL, { method: "POST" }))).rejects.toThrow(
      DEADLOCK_MESSAGE,
    );

    expect(redis.has(deletedUserTombstoneKey(DELETED_USER))).toBe(false);
    expect(posted).toEqual([]);
    expect(queuedAtDeleteTime.count).toBe(GOOGLE_ACCOUNT_COUNT);
    expect(residue.rowsOfKind(OAUTH_GRANT_KIND, DELETED_USER)).toEqual([]);
  });

  it("records every revocable credential as residue that the reaper then revokes", async () => {
    const capture = await startWideEventCapture();

    const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");
    const { createTeardownResidueReaper, revokeGoogleGrant } = await import("@keeper.sh/calendar");

    const teardownPosts: PostedRevocation[] = [];
    const residue = createResidueHarness();
    const redis = createRedisHarness();
    const credentials = googleCredentials(GOOGLE_ACCOUNT_COUNT);

    await createDeleteUserSyncTeardown(
      createTeardownDependencies({
        credentials,
        fetchImpl: createRevokeEndpoint(
          teardownPosts,
          PROVIDER_ROUND_TRIP_MS,
        ) as unknown as typeof fetch,
        redis: redis.redis,
        residue: residue.store,
      }) as never,
    )(DELETED_USER);

    expect(teardownPosts).toEqual([]);

    const recorded = residue.rowsOfKind(OAUTH_GRANT_KIND, DELETED_USER);

    expect(recorded).toHaveLength(GOOGLE_ACCOUNT_COUNT);
    expect(recorded.map((row) => row.credential?.refreshToken ?? "").toSorted()).toEqual(
      refreshTokensOf(credentials),
    );
    expect(recorded.map((row) => row.externalId ?? "").toSorted()).toEqual(
      credentials.map((credential) => credential.accountId).toSorted(),
    );
    expect(recorded.every((row) => row.provider === "google")).toBe(true);

    const fields = flattenFields(capture.loggedFields);

    expect(fields["delete_user.oauth_grants_recorded"]).toBe(GOOGLE_ACCOUNT_COUNT);

    const reaperPosts: PostedRevocation[] = [];
    const reap = createTeardownResidueReaper({
      countSurvivingAccountLinks: () =>
      Promise.resolve({ coHolders: 0, identityResolved: true }),
      createRegistrarContext: () =>
        Promise.reject(new Error("push channels are not part of this test")),
      deletePolarCustomer: () => Promise.reject(new Error("polar is not part of this test")),
      now: () => new Date("2026-08-26T12:00:00.000Z"),
      observe: () => undefined,
      recordError: (error: unknown) => {
        throw error;
      },
      residue: residue.reaperStore,
      resolveRegistrar: () => null,
      revokeOAuthGrant: async (record: { id: string }, token: string) => {
        const outcome = await revokeGoogleGrant(token, {
          fetchImpl: createRevokeEndpoint(reaperPosts, 0) as unknown as typeof fetch,
        });

        if (!outcome.revoked) {
          throw new Error(`revocation refused for residue ${record.id}`);
        }
      },
    } as never);

    const outcome = await reap();

    expect(tokensOf(reaperPosts)).toEqual(refreshTokensOf(credentials));
    expect(reaperPosts.every((entry) => entry.url === REVOKE_ENDPOINT)).toBe(true);
    expect(reaperPosts.every((entry) => entry.method === "POST")).toBe(true);
    expect(
      reaperPosts.every((entry) => entry.contentType.includes("application/x-www-form-urlencoded")),
    ).toBe(true);
    expect(outcome.failedIds).toEqual([]);
    expect(residue.rowsOfKind(OAUTH_GRANT_KIND, DELETED_USER)).toEqual([]);
  });

  it("records a credential whose provider still has push channel residue instead of dropping it", async () => {
    const capture = await startWideEventCapture();

    const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");

    const posted: PostedRevocation[] = [];
    const residue = createResidueHarness([
      {
        kind: PUSH_CHANNEL_KIND,
        provider: "google",
        providerChannelId: "google-channel-1",
        userId: DELETED_USER,
      },
    ]);
    const redis = createRedisHarness();
    const credentials = googleCredentials(GOOGLE_ACCOUNT_COUNT);

    await createDeleteUserSyncTeardown(
      createTeardownDependencies({
        credentials,
        fetchImpl: createRevokeEndpoint(posted, 0) as unknown as typeof fetch,
        redis: redis.redis,
        residue: residue.store,
      }) as never,
    )(DELETED_USER);

    expect(posted).toEqual([]);

    const recorded = residue.rowsOfKind(OAUTH_GRANT_KIND, DELETED_USER);

    expect(recorded).toHaveLength(GOOGLE_ACCOUNT_COUNT);
    expect(recorded.map((row) => row.credential?.refreshToken ?? "").toSorted()).toEqual(
      refreshTokensOf(credentials),
    );

    const fields = flattenFields(capture.loggedFields);

    expect(fields["delete_user.oauth_grants_recorded"]).toBe(GOOGLE_ACCOUNT_COUNT);
  });
});
