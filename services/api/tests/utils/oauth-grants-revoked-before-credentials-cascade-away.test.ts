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
const SERVICE_UNAVAILABLE = 503;
const BAD_REQUEST = 400;

interface RevocationCredential {
  accessToken: string;
  accountId: string;
  provider: string;
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

const seedCredentials = (): RevocationCredential[] => [
  {
    accessToken: "access-token-A-google",
    accountId: "account-A",
    provider: "google",
    refreshToken: "refresh-token-A-google",
    userId: DELETED_USER,
  },
  {
    accessToken: "access-token-B-google",
    accountId: "account-B",
    provider: "google",
    refreshToken: "refresh-token-B-google",
    userId: SURVIVING_USER,
  },
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

const KNOWN_GOOGLE_TOKENS = new Set([
  "refresh-token-A-google",
  "access-token-A-google",
  "refresh-token-B-google",
  "access-token-B-google",
]);

const makeGoogleRevocationEndpoint = (
  issued: IssuedRevocation[],
  events: string[],
  respond?: () => Response,
) =>
  async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const call = await readIssued(input, init);

    issued.push(call);
    events.push("revoke");

    if (respond) {
      return respond();
    }

    if (call.token === null || !KNOWN_GOOGLE_TOKENS.has(call.token)) {
      return new Response(
        JSON.stringify({ error: "invalid_token" }),
        { headers: { "content-type": "application/json" }, status: BAD_REQUEST },
      );
    }

    return new Response("", { status: 200 });
  };

interface ResidueRecord {
  accountId?: string;
  credential?: { accessToken: string; expiresAt: Date | null; refreshToken: string | null };
  id: string;
  kind: string;
  provider?: string;
  providerChannelId?: string;
  userId: string;
}

const makeResidueHarness = (seeded: Omit<ResidueRecord, "id">[] = []) => {
  const rows = new Map<string, ResidueRecord>(
    seeded.map((row, index) => [`seed-${index}`, { ...row, id: `seed-${index}` }]),
  );

  return {
    list: (): Promise<ResidueRecord[]> => Promise.resolve([...rows.values()]),
    store: {
      clear: (residueId: string) => {
        rows.delete(residueId);
        return Promise.resolve();
      },
      list: (): Promise<ResidueRecord[]> => Promise.resolve([...rows.values()]),
      record: (draft: Omit<ResidueRecord, "id">) => {
        const id = `residue-${rows.size + 1}`;
        rows.set(id, { ...draft, id });
        return Promise.resolve();
      },
    },
  };
};

const makeDependencies = (options: {
  credentials: RevocationCredential[];
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
  redis: {
    del: () => Promise.resolve(1),
    exists: () => Promise.resolve(0),
    set: () => Promise.resolve("OK"),
  },
  residue: options.residue.store,
});

const importSyncTeardown = async () => await import("@/utils/delete-user-teardown");

const flattenFields = (loggedFields: Record<string, unknown>[]): Record<string, unknown> =>
  loggedFields.reduce((all, fields) => ({ ...all, ...fields }), {});

describe("oauth grants are revoked before the credentials cascade away", () => {
  it("posts the deleted user's google refresh token to the revoke endpoint before resolving", async () => {
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

    expect(issued).toHaveLength(1);
    expect(issued[0]?.method).toBe("POST");
    expect(issued[0]?.url).toBe(GOOGLE_REVOKE_URL);
    expect(issued[0]?.contentType).toContain("application/x-www-form-urlencoded");
    expect(issued[0]?.token).toBe("refresh-token-A-google");
  });

  it("attempts revocation only after push channel deregistration has settled", async () => {
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

    expect(events).toEqual(["push_channels", "revoke"]);
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
            provider: "microsoft",
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

    const fields = flattenFields(capture.loggedFields);

    expect(fields["delete_user.oauth_grants_revoked"]).toBe(0);
    expect(JSON.stringify(fields["delete_user.oauth_grants_not_revocable"])).toContain(
      "microsoft",
    );
  });

  it("leaves durable residue and keeps going when the provider answers 503", async () => {
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
          fetchImpl: makeGoogleRevocationEndpoint(
            issued,
            events,
            () => new Response('{"error":"internal_failure"}', { status: SERVICE_UNAVAILABLE }),
          ) as unknown as typeof fetch,
          residue,
        }) as never,
      )(DELETED_USER),
    ).resolves.toBeUndefined();

    expect(issued).toHaveLength(1);

    const rows = await residue.list();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "oauth_grant",
      provider: "google",
      userId: DELETED_USER,
    });
    expect(rows[0]?.credential?.refreshToken).toBe("refresh-token-A-google");
  });

  it("defers revocation while an abandoned push channel residue still needs the token", async () => {
    const capture = await startWideEventCapture();
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const events: string[] = [];
    const issued: IssuedRevocation[] = [];
    const residue = makeResidueHarness([
      {
        accountId: "account-A",
        credential: {
          accessToken: "access-token-A-google",
          expiresAt: null,
          refreshToken: "refresh-token-A-google",
        },
        kind: "push_channel",
        provider: "google",
        providerChannelId: "google-A-1",
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

    expect(issued).toEqual([]);

    const fields = flattenFields(capture.loggedFields);

    expect(fields["delete_user.oauth_grants_deferred"]).toBe(1);
  });

  it("issues no revocation at all from the teardown rollback", async () => {
    await startWideEventCapture();
    const { createDeleteUserSyncTeardownRollback } = await importSyncTeardown();
    const events: string[] = [];
    const issued: IssuedRevocation[] = [];
    const residue = makeResidueHarness();

    await createDeleteUserSyncTeardownRollback(
      makeDependencies({
        credentials: seedCredentials(),
        events,
        fetchImpl: makeGoogleRevocationEndpoint(issued, events) as unknown as typeof fetch,
        residue,
      }) as never,
    )(DELETED_USER);

    expect(issued).toEqual([]);
    expect(events).toEqual([]);
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

    expect(issued.length).toBeGreaterThan(0);
    expect(
      issued.every((call) => call.token === "refresh-token-A-google"),
    ).toBe(true);
    expect(issued.some((call) => call.body.includes(SURVIVING_USER.toLowerCase()))).toBe(false);
    expect(issued.some((call) => call.body.includes("token-B-google"))).toBe(false);
  });
});
