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

type FetchInput = Parameters<typeof fetch>[0];

const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DELETED_USER = "A";
const SURVIVING_USER = "B";
const OAUTH_GRANT_KIND = "oauth_grant";
const PUSH_CHANNEL_KIND = "push_channel";
const SERVICE_UNAVAILABLE = 503;
const OK = 200;
const REAP_TIME = new Date("2026-08-26T12:00:00.000Z");

interface TeardownCredential {
  accessToken: string;
  accountId: string;
  email: string | null;
  provider: string;
  providerAccountId: string;
  refreshToken: string | null;
  userId: string;
}

interface IssuedRevocation {
  body: string;
  contentType: string | null;
  method: string;
  token: string | null;
  url: string;
}

const googleCredentialFor = (userId: string): TeardownCredential => ({
  accessToken: `access-token-${userId}-google`,
  accountId: `account-${userId}`,
  email: `${userId.toLowerCase()}@gmail.com`,
  provider: "google",
  providerAccountId: `provider-account-${userId}`,
  refreshToken: `refresh-token-${userId}-google`,
  userId,
});

const seedCredentials = (): TeardownCredential[] => [
  googleCredentialFor(DELETED_USER),
  googleCredentialFor(SURVIVING_USER),
];

const readIssued = async (
  input: FetchInput,
  init: RequestInit | undefined,
): Promise<IssuedRevocation> => {
  const request =
    input instanceof Request ? new Request(input, init) : new Request(String(input), init);
  const body = await request.text();

  return {
    body,
    contentType: request.headers.get("content-type"),
    method: request.method,
    token: new URLSearchParams(body).get("token"),
    url: request.url,
  };
};

const makeGoogleRevocationEndpoint =
  (issued: IssuedRevocation[], events: string[], status = OK) =>
  async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    issued.push(await readIssued(input, init));
    events.push("revoke");

    return new Response("", { status });
  };

interface ResidueRow {
  accountEmail?: string;
  credential?: { accessToken: string; expiresAt: Date | null; refreshToken: string | null };
  expiresAt?: Date;
  externalId?: string;
  id: string;
  kind: string;
  provider?: string;
  providerAccountId?: string;
  providerChannelId?: string;
  providerResourceId?: string;
  userId: string;
}

const makeResidueHarness = (seeded: Omit<ResidueRow, "id">[] = []) => {
  const rows = new Map<string, ResidueRow>(
    seeded.map((row, index) => [`seed-${index}`, { ...row, id: `seed-${index}` }]),
  );
  const issued = { count: 0 };

  const clear = (residueId: string): Promise<void> => {
    rows.delete(residueId);
    return Promise.resolve();
  };

  return {
    reaperStore: {
      clear,
      list: (): Promise<ResidueRow[]> => Promise.resolve([...rows.values()]),
      purgeOrphaned: (): Promise<string[]> => Promise.resolve([]),
      record: (draft: Omit<ResidueRow, "id">): Promise<void> => {
        issued.count += 1;
        rows.set(`residue-${issued.count}`, { ...draft, id: `residue-${issued.count}` });
        return Promise.resolve();
      },
      spendRepairAttempt: (residueId: string): Promise<number> => {
        if (!rows.has(residueId)) {
          return Promise.reject(new Error(`residue ${residueId} is not in this batch`));
        }

        return Promise.resolve(0);
      },
    },
    rowsOfKind: (kind: string): ResidueRow[] =>
      [...rows.values()].filter((row) => row.kind === kind),
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
      list: (): Promise<ResidueRow[]> =>
        Promise.resolve([...rows.values()].filter((row) => row.kind === PUSH_CHANNEL_KIND)),
      record: (draft: Omit<ResidueRow, "id">): Promise<void> => {
        issued.count += 1;
        rows.set(`residue-${issued.count}`, { ...draft, id: `residue-${issued.count}` });
        return Promise.resolve();
      },
    },
  };
};

const makeDependencies = (options: {
  credentials: TeardownCredential[];
  events: string[];
  fetchImpl: typeof fetch;
  residue: ReturnType<typeof makeResidueHarness>;
}) => ({
  createQueue: () => ({
    getJob: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(0),
  }),
  deregisterPushChannels: () => {
    options.events.push("push_channels");
    return Promise.resolve(0);
  },
  fetchImpl: options.fetchImpl,
  listCalendarIds: () => Promise.resolve([]),
  listOAuthCredentials: (userId: string) =>
    Promise.resolve(options.credentials.filter((row) => row.userId === userId)),
  listPushChannels: () => Promise.resolve([]),
  redis: {
    del: () => Promise.resolve(1),
    exists: () => Promise.resolve(0),
    set: () => Promise.resolve("OK"),
  },
  residue: options.residue.store,
});

const makeReaper = async (options: {
  issued: IssuedRevocation[];
  events: string[];
  residue: ReturnType<typeof makeResidueHarness>;
  status?: number;
}) => {
  const { createTeardownResidueReaper, revokeGoogleGrant } = await import("@keeper.sh/calendar");

  return createTeardownResidueReaper({
    countSurvivingAccountLinks: () =>
      Promise.resolve({ coHolders: 0, identityResolved: true }),
    createRegistrarContext: () =>
      Promise.reject(new Error("push channel repair is not part of this test")),
    deletePolarCustomer: () => Promise.reject(new Error("polar is not part of this test")),
    now: () => REAP_TIME,
    observe: () => undefined,
    recordError: () => undefined,
    residue: options.residue.reaperStore,
    resolveRegistrar: () => null,
    revokeOAuthGrant: async (record: { id: string }, token: string) => {
      const outcome = await revokeGoogleGrant(token, {
        fetchImpl: makeGoogleRevocationEndpoint(
          options.issued,
          options.events,
          options.status ?? OK,
        ) as unknown as typeof fetch,
      });

      if (!outcome.revoked) {
        throw new Error(`revocation refused for residue ${record.id}`);
      }
    },
  } as never);
};

const importSyncTeardown = async () => await import("@/utils/delete-user-teardown");

const flattenFields = (loggedFields: Record<string, unknown>[]): Record<string, unknown> =>
  loggedFields.reduce((all, fields) => ({ ...all, ...fields }), {});

describe("revocable grants are recorded for the reaper", () => {
  it("records the deleted user's google refresh token instead of posting it during the delete", async () => {
    await startWideEventCapture();
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const events: string[] = [];
    const issued: IssuedRevocation[] = [];
    const residue = makeResidueHarness();

    await expect(
      createDeleteUserSyncTeardown(
        makeDependencies({
          credentials: seedCredentials(),
          events,
          fetchImpl: makeGoogleRevocationEndpoint(issued, events) as unknown as typeof fetch,
          residue,
        }) as never,
      )(DELETED_USER),
    ).resolves.toBeUndefined();

    expect(issued).toEqual([]);

    const recorded = residue.rowsOfKind(OAUTH_GRANT_KIND);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.userId).toBe(DELETED_USER);
    expect(recorded[0]?.provider).toBe("google");
    expect(recorded[0]?.credential?.refreshToken).toBe("refresh-token-A-google");
    expect(recorded[0]?.accountEmail).toBe("a@gmail.com");
  });

  it("records the grant only after push channel deregistration has settled", async () => {
    await startWideEventCapture();
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const events: string[] = [];
    const issued: IssuedRevocation[] = [];
    const residue = makeResidueHarness();

    await createDeleteUserSyncTeardown(
      makeDependencies({
        credentials: seedCredentials(),
        events,
        fetchImpl: makeGoogleRevocationEndpoint(issued, events) as unknown as typeof fetch,
        residue,
      }) as never,
    )(DELETED_USER);

    expect(events).toEqual(["push_channels"]);
    expect(residue.rowsOfKind(OAUTH_GRANT_KIND)).toHaveLength(1);
  });

  it("records that a microsoft grant survives instead of fabricating a revocation", async () => {
    const capture = await startWideEventCapture();
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const events: string[] = [];
    const issued: IssuedRevocation[] = [];
    const residue = makeResidueHarness();

    await createDeleteUserSyncTeardown(
      makeDependencies({
        credentials: [
          {
            accessToken: "access-token-A-microsoft",
            accountId: "account-A-outlook",
            email: "a@outlook.com",
            provider: "microsoft",
            providerAccountId: "provider-account-A-microsoft",
            refreshToken: "refresh-token-A-microsoft",
            userId: DELETED_USER,
          },
        ],
        events,
        fetchImpl: makeGoogleRevocationEndpoint(issued, events) as unknown as typeof fetch,
        residue,
      }) as never,
    )(DELETED_USER);

    expect(issued).toEqual([]);
    expect(residue.rowsOfKind(OAUTH_GRANT_KIND)).toEqual([]);

    const fields = flattenFields(capture.loggedFields);

    expect(fields["delete_user.oauth_grants_recorded"]).toBe(0);
    expect(JSON.stringify(fields["delete_user.oauth_grants_not_revocable"])).toContain(
      "microsoft",
    );

    const reaperIssued: IssuedRevocation[] = [];
    const reap = await makeReaper({ events, issued: reaperIssued, residue });

    await reap();

    expect(reaperIssued).toEqual([]);
  });

  it("keeps the residue when the reaper's revocation is refused so it can be retried", async () => {
    await startWideEventCapture();
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const events: string[] = [];
    const issued: IssuedRevocation[] = [];
    const residue = makeResidueHarness();

    await createDeleteUserSyncTeardown(
      makeDependencies({
        credentials: seedCredentials(),
        events,
        fetchImpl: makeGoogleRevocationEndpoint(issued, events) as unknown as typeof fetch,
        residue,
      }) as never,
    )(DELETED_USER);

    const reaperIssued: IssuedRevocation[] = [];
    const reap = await makeReaper({
      events,
      issued: reaperIssued,
      residue,
      status: SERVICE_UNAVAILABLE,
    });

    const outcome = await reap();

    expect(reaperIssued).toHaveLength(1);
    expect(outcome.failedIds).toHaveLength(1);

    const kept = residue.rowsOfKind(OAUTH_GRANT_KIND);

    expect(kept).toHaveLength(1);
    expect(kept[0]?.credential?.refreshToken).toBe("refresh-token-A-google");
  });

  it("leaves the grant unrevoked while an abandoned push channel still needs the token", async () => {
    await startWideEventCapture();
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const events: string[] = [];
    const issued: IssuedRevocation[] = [];
    const residue = makeResidueHarness([
      {
        credential: {
          accessToken: "access-token-A-google",
          expiresAt: null,
          refreshToken: "refresh-token-A-google",
        },
        kind: PUSH_CHANNEL_KIND,
        provider: "google",
        providerChannelId: "google-A-1",
        providerResourceId: "resource-A-1",
        userId: DELETED_USER,
      },
    ]);

    await createDeleteUserSyncTeardown(
      makeDependencies({
        credentials: seedCredentials(),
        events,
        fetchImpl: makeGoogleRevocationEndpoint(issued, events) as unknown as typeof fetch,
        residue,
      }) as never,
    )(DELETED_USER);

    expect(residue.rowsOfKind(OAUTH_GRANT_KIND)).toHaveLength(1);

    const reaperIssued: IssuedRevocation[] = [];
    const reap = await makeReaper({ events, issued: reaperIssued, residue });

    await reap();

    expect(reaperIssued).toEqual([]);
    expect(residue.rowsOfKind(OAUTH_GRANT_KIND)).toHaveLength(1);
  });

  it("issues no revocation and discards recorded grants from the teardown rollback", async () => {
    await startWideEventCapture();
    const { createDeleteUserSyncTeardown, createDeleteUserSyncTeardownRollback } =
      await importSyncTeardown();
    const events: string[] = [];
    const issued: IssuedRevocation[] = [];
    const residue = makeResidueHarness();
    const dependencies = makeDependencies({
      credentials: seedCredentials(),
      events,
      fetchImpl: makeGoogleRevocationEndpoint(issued, events) as unknown as typeof fetch,
      residue,
    });

    await createDeleteUserSyncTeardown(dependencies as never)(DELETED_USER);

    expect(residue.rowsOfKind(OAUTH_GRANT_KIND)).toHaveLength(1);

    events.length = 0;

    await createDeleteUserSyncTeardownRollback(dependencies as never)(DELETED_USER);

    expect(issued).toEqual([]);
    expect(events).toEqual([]);
    expect(residue.rowsOfKind(OAUTH_GRANT_KIND)).toEqual([]);
  });

  it("never carries another user's token into a revocation request", async () => {
    await startWideEventCapture();
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const events: string[] = [];
    const issued: IssuedRevocation[] = [];
    const residue = makeResidueHarness();

    await createDeleteUserSyncTeardown(
      makeDependencies({
        credentials: seedCredentials(),
        events,
        fetchImpl: makeGoogleRevocationEndpoint(issued, events) as unknown as typeof fetch,
        residue,
      }) as never,
    )(DELETED_USER);

    const reaperIssued: IssuedRevocation[] = [];
    const reap = await makeReaper({ events, issued: reaperIssued, residue });

    await reap();

    expect(reaperIssued).toHaveLength(1);
    expect(reaperIssued.every((call) => call.token === "refresh-token-A-google")).toBe(true);
    expect(reaperIssued.every((call) => call.url === GOOGLE_REVOKE_URL)).toBe(true);
    expect(reaperIssued.every((call) => call.method === "POST")).toBe(true);
    expect(
      reaperIssued.every((call) =>
        (call.contentType ?? "").includes("application/x-www-form-urlencoded"),
      ),
    ).toBe(true);
    expect(reaperIssued.some((call) => call.body.includes("token-B-google"))).toBe(false);
  });

  it("records nothing and revokes nothing when the credential listing leaks a foreign row", async () => {
    await startWideEventCapture();
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const events: string[] = [];
    const issued: IssuedRevocation[] = [];
    const residue = makeResidueHarness();
    const dependencies = {
      ...makeDependencies({
        credentials: seedCredentials(),
        events,
        fetchImpl: makeGoogleRevocationEndpoint(issued, events) as unknown as typeof fetch,
        residue,
      }),
      listOAuthCredentials: () => Promise.resolve(seedCredentials()),
    };

    await createDeleteUserSyncTeardown(dependencies as never)(DELETED_USER);

    expect(residue.rowsOfKind(OAUTH_GRANT_KIND)).toEqual([]);

    const reaperIssued: IssuedRevocation[] = [];
    const reap = await makeReaper({ events, issued: reaperIssued, residue });

    await reap();

    expect(reaperIssued).toEqual([]);
  });
});
