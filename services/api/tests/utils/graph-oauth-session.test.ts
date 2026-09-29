import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptPassword } from "@keeper.sh/database";
const state = vi.hoisted(() => ({
  values: new Map<string, string>(),
  key: Buffer.alloc(32, 9).toString("base64"),
  result: "authorization_pending",
  polls: 0,
}));
vi.mock("@/context", () => ({
  encryptionKey: state.key,
  redis: {
    get: (key: string) => Promise.resolve(state.values.get(key) ?? null),
    set: (
      key: string,
      value: string,
      _expiry: string,
      _seconds: number,
      condition?: string,
    ) => {
      if (condition === "NX" && state.values.has(key))
        {return Promise.resolve(null);}
      state.values.set(key, value);
      return Promise.resolve("OK");
    },
    del: (key: string) => Promise.resolve(Number(state.values.delete(key))),
    eval: (_script: string, _count: number, key: string, owner: string) => {
      if (state.values.get(key) === owner) {state.values.delete(key);}
      return Promise.resolve(1);
    },
  },
}));
vi.mock("@/utils/safe-fetch-options", () => ({ safeFetchOptions: {} }));
vi.mock("@keeper.sh/calendar/ews", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  beginEwsDeviceAuthorization: () =>
    Promise.resolve({
      deviceCode: "secret-device",
      userCode: "VISIBLE",
      verificationUri: "https://id.example.test/verify",
      expiresAt: Date.now() + 900_000,
      interval: 5,
    }),
  pollEwsDeviceAuthorization: (config: { auth: object }) => {
    state.polls += 1;
    if (state.result === "authorized")
      {Object.assign(config.auth, {
        accessToken: "secret-access",
        refreshToken: "secret-refresh",
        expiresAt: Date.now() + 3_600_000,
      });}
    return Promise.resolve(state.result);
  },
}));
const { startGraphSession, pollGraphSession, withAuthorizedGraphSession } = await import("@/utils/graph-oauth-session");
const config = { clientId: "11111111-1111-4111-8111-111111111111", tenant: "organizations", scope: "openid profile offline_access" };
beforeEach(() => {
  state.values.clear(); state.polls = 0; state.result = "authorization_pending";
  vi.spyOn(Date, "now").mockReturnValue(100_000);
});
afterEach(() => vi.restoreAllMocks());
describe("Graph device sessions", () => {
  it("keeps EWS and Graph sessions isolated for the same user", async () => {
    const { pollEwsSession } = await import("@/utils/ews-oauth-session");
    const { sessionId } = await startGraphSession("owner", config);
    await expect(pollEwsSession("owner", sessionId)).rejects.toThrow("expired");
    expect(state.values.has(`graph:oauth:owner:${sessionId}`)).toBe(true);
  });
  it("does not allow concurrent use of the same authorization session", async () => {
    const { sessionId } = await startGraphSession("owner", config);
    state.values.set(`graph:oauth:owner:${sessionId}:lock`, "another-owner");
    await expect(pollGraphSession("owner", sessionId)).rejects.toThrow("busy");
    expect(state.values.get(`graph:oauth:owner:${sessionId}:lock`)).toBe("another-owner");
  });
  it("encrypts the pending session and ignores injected tokens", async () => {
    const result = await startGraphSession("owner", { ...config, accessToken: "injected" });
    expect(JSON.stringify(result)).not.toContain("secret-device");
    const encrypted = [...state.values.values()][0] ?? "";
    expect(encrypted).not.toContain("secret-device");
    expect(decryptPassword(encrypted, state.key)).toContain(config.clientId);
    expect(decryptPassword(encrypted, state.key)).toContain(config.scope);
    expect(decryptPassword(encrypted, state.key)).not.toContain("injected");
  });
  it("prevents cross-user reuse and premature connection", async () => {
    const { sessionId } = await startGraphSession("owner", config);
    await expect(pollGraphSession("other", sessionId)).rejects.toThrow();
    await expect(withAuthorizedGraphSession("owner", sessionId, () => Promise.resolve(true))).rejects.toThrow();
  });
  it("enforces poll timing, then retains the chosen application", async () => {
    const { sessionId } = await startGraphSession("owner", config);
    await pollGraphSession("owner", sessionId);
    expect(state.polls).toBe(0);
    vi.mocked(Date.now).mockReturnValue(105_000);
    state.result = "authorized";
    await pollGraphSession("owner", sessionId);
    const connection = await withAuthorizedGraphSession("owner", sessionId, (session) => Promise.resolve(session.connection));
    expect(connection).toEqual(config);
  });
  it("expires pending sessions", async () => {
    const { sessionId } = await startGraphSession("owner", config);
    vi.mocked(Date.now).mockReturnValue(2_000_000);
    await expect(pollGraphSession("owner", sessionId)).rejects.toThrow("expired");
  });
});
