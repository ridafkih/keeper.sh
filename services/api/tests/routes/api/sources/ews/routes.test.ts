import { beforeEach, describe, expect, it, vi } from "vitest";
import { decryptPassword, encryptPassword } from "@keeper.sh/database";
import { parseEwsConfig } from "@keeper.sh/calendar/ews";

const state = vi.hoisted(() => ({
  discoveries: [
    { id: "folder", name: "Agenda", canRead: true, canWrite: true },
  ],
  discoveryError: false,
  transactionError: false,
  sessions: new Map<string, string>(),
  transactionCount: 0,
  inserted: [] as Record<string, unknown>[],
  calendars: [] as Record<string, unknown>[],
  accountCount: 0,
  encryptionKey: Buffer.alloc(32, 7).toString("base64"),
}));
vi.mock("@keeper.sh/calendar/ews", async (original) => {
  const actual = await original<Record<string, unknown>>();
  return {
    ...actual,
    EwsClient: class {
      private readonly fixture = state;
      discoverCalendars() {
        if (this.fixture.discoveryError) {
          return Promise.reject(new Error("private-secret-in-provider-error"));
        }
        return Promise.resolve(this.fixture.discoveries);
      }
    },
  };
});
vi.mock("@/utils/middleware", () => ({
  withAuth: (handler: (ctx: unknown) => unknown) => (ctx: object) =>
    handler({ ...ctx, userId: "owner" }),
  withWideEvent: (handler: unknown) => handler,
}));
vi.mock("@/utils/safe-fetch-options", () => ({
  safeFetchOptions: { blockPrivateResolution: true },
}));
vi.mock("@/context", () => ({
  encryptionKey: state.encryptionKey,
  redis: {
    get: (key: string) => Promise.resolve(state.sessions.get(key) ?? null),
    del: (key: string) => Promise.resolve(Number(state.sessions.delete(key))),
  },
  premiumService: {
    getUserPlan: () => Promise.resolve("pro"),
    getAccountLimit: () => 5,
  },
  database: {
    transaction: async (run: (tx: unknown) => unknown) => {
      state.transactionCount += 1;
      if (state.transactionError) {
        throw new Error("SQL secret-bound-parameters");
      }
      const tx = {
        execute: () => Promise.resolve(),
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([{ value: state.accountCount }]),
          }),
        }),
        insert: () => ({
          values: (values: Record<string, unknown>) => {
            state.inserted.push(values);
            return Object.assign(Promise.resolve([]), {
              returning: () => Promise.resolve([{ id: "account" }]),
            });
          },
        }),
      };
      return await run(tx);
    },
  },
}));
vi.mock("@/utils/source-calendar-insert", () => ({
  createSourceCalendarInsertDependencies: () => ({}),
  insertSourceCalendars: (
    _dependencies: unknown,
    _userId: string,
    rows: Record<string, unknown>[],
  ) => {
    state.calendars = rows;
    return Promise.resolve(rows);
  },
}));
const { POST: connectHandler } = await import("@/routes/api/sources/ews/index");
const { POST: discoverHandler } =
  await import("@/routes/api/sources/ews/discover");
// Middleware is replaced above so route logic can run without a server or session.
const connect = connectHandler as unknown as (context: {
  request: Request;
}) => Promise<Response>;
const discover = discoverHandler as unknown as (context: {
  request: Request;
}) => Promise<Response>;
const config = {
  serverUrl: "https://arbitrary.example.test/service",
  auth: {
    type: "oauth2-client-credentials",
    tokenUrl: "https://arbitrary-id.example.test/token",
    clientId: "app",
    clientSecret: "application-secret",
    scope: "calendar-scope",
  },
};
const request = (body: unknown) => ({
  request: new Request("https://keeper.example.test/api/sources/ews", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }),
});
beforeEach(() => {
  state.discoveryError = false;
  state.transactionError = false;
  state.transactionCount = 0;
  state.sessions.clear();
  state.inserted = [];
  state.calendars = [];
  state.accountCount = 0;
  state.discoveries = [
    { id: "folder", name: "Agenda", canRead: true, canWrite: true },
  ];
});
describe("EWS connection routes", () => {
  it("returns discovery metadata without secrets and without persisting", async () => {
    const response = await discover(request({ config }) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ calendars: state.discoveries });
    expect(state.transactionCount).toBe(0);
  });
  it.each(["basic", "bearer"])(
    "rejects %s before discovery or persistence",
    async (type) => {
      const response = await connect(
        request({
          config: { ...config, auth: { type } },
          name: "Work",
          calendarIds: ["folder"],
        }) as never,
      );
      expect(response.status).toBe(400);
      expect(state.transactionCount).toBe(0);
    },
  );
  it("persists encrypted OAuth2 settings and only selected calendars", async () => {
    const response = await connect(
      request({ config, name: "Work", calendarIds: ["folder"] }) as never,
    );
    expect(response.status).toBe(201);
    const credential = state.inserted.find((row) => "encryptedConfig" in row);
    expect(credential?.encryptedConfig).not.toContain("application-secret");
    expect(
      JSON.parse(
        decryptPassword(
          String(credential?.encryptedConfig),
          state.encryptionKey,
        ),
      ),
    ).toEqual(parseEwsConfig(config));
    expect(state.calendars).toMatchObject([
      {
        userId: "owner",
        calendarType: "ews",
        externalCalendarId: "folder",
        capabilities: ["pull", "push"],
      },
    ]);
  });
  it("does not grant push capability for read-only folders", async () => {
    state.discoveries = [
      { id: "folder", name: "Agenda", canRead: true, canWrite: false },
    ];
    await connect(
      request({ config, name: "Work", calendarIds: ["folder"] }) as never,
    );
    expect(state.calendars[0]?.capabilities).toEqual(["pull"]);
  });
  it("rejects a submitted folder absent from discovery", async () => {
    const response = await connect(
      request({
        config,
        name: "Work",
        calendarIds: ["foreign-folder"],
      }) as never,
    );
    expect(response.status).toBe(400);
    expect(state.transactionCount).toBe(0);
  });
  it("keeps provider and database diagnostics out of responses", async () => {
    state.discoveryError = true;
    const discovery = await discover(request({ config }) as never);
    expect(await discovery.text()).not.toContain("private-secret");
    state.discoveryError = false;
    state.transactionError = true;
    const saved = await connect(
      request({ config, name: "Work", calendarIds: ["folder"] }) as never,
    );
    expect(saved.status).toBe(400);
    expect(await saved.text()).not.toContain("secret-bound");
  });
  it("enforces account allowance before storing secrets", async () => {
    state.accountCount = 5;
    const response = await connect(
      request({ config, name: "Work", calendarIds: ["folder"] }) as never,
    );
    expect(response.status).toBe(400);
    expect(state.inserted).toEqual([]);
  });
});

describe("EWS authorized user connection persistence", () => {
  it("saves server-held user credentials encrypted and consumes the session", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const userConfig = {
      ...config,
      mailbox: "user@example.test",
      auth: {
        ...config.auth,
        type: "oauth2-user",
        deviceAuthorizationUrl: "https://id.example.test/device",
        accessToken: "server-access",
        refreshToken: "server-refresh",
        expiresAt: Date.now() + 3_600_000,
      },
    };
    const sessionKey = `ews:oauth:owner:${sessionId}`;
    state.sessions.set(
      sessionKey,
      encryptPassword(
        JSON.stringify({
          config: userConfig,
          authorized: true,
          expiresAt: Date.now() + 900_000,
          interval: 5,
          nextPoll: 0,
        }),
        state.encryptionKey,
      ),
    );
    const response = await connect(
      request({
        sessionId,
        name: "User Exchange",
        calendarIds: ["folder"],
        config: { serverUrl: "https://ignored.example.test" },
      }),
    );
    expect(response.status).toBe(201);
    const stored = state.inserted.find(
      (entry) => typeof entry.encryptedConfig === "string",
    );
    const encrypted = String(stored?.encryptedConfig);
    expect(encrypted).not.toContain("server-refresh");
    expect(
      JSON.parse(decryptPassword(encrypted, state.encryptionKey)).auth,
    ).toMatchObject({ type: "oauth2-user", refreshToken: "server-refresh" });
    expect(state.sessions.has(sessionKey)).toBe(false);
    expect(await response.text()).not.toContain("server-access");
  });
  it("rejects manually submitted user tokens", async () => {
    const response = await connect(
      request({
        name: "User",
        calendarIds: ["folder"],
        config: {
          ...config,
          auth: {
            ...config.auth,
            type: "oauth2-user",
            deviceAuthorizationUrl: "https://id.example.test/device",
            refreshToken: "injected",
          },
        },
      }),
    );
    expect(response.status).toBe(400);
    expect(state.transactionCount).toBe(0);
  });
});

describe("EWS NTLM connection persistence", () => {
  it("discovers and saves configurable NTLM credentials encrypted", async () => {
    const ntlmConfig = {
      ...config,
      auth: { type: "ntlm", username: "person@example.test", password: "ntlm-test-secret" },
    };
    const discovered = await discover(request({ config: ntlmConfig }));
    expect(discovered.status).toBe(200);
    expect(await discovered.text()).not.toContain("ntlm-test-secret");
    const response = await connect(request({ config: ntlmConfig, name: "Exchange NTLM", calendarIds: ["folder"] }));
    expect(response.status).toBe(201);
    const stored = state.inserted.find((entry) => typeof entry.encryptedConfig === "string");
    const encrypted = String(stored?.encryptedConfig);
    expect(encrypted).not.toContain("ntlm-test-secret");
    expect(JSON.parse(decryptPassword(encrypted, state.encryptionKey)).auth).toEqual(ntlmConfig.auth);
    expect(await response.text()).not.toContain("ntlm-test-secret");
  });
});
