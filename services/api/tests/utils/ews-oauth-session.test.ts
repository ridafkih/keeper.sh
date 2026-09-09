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
const { startEwsSession, pollEwsSession, resolveEwsRequest, removeEwsSession } =
  await import("@/utils/ews-oauth-session");
const config = {
  serverUrl: "https://ews.example.test/service",
  mailbox: "user@example.test",
  auth: {
    type: "oauth2-user",
    deviceAuthorizationUrl: "https://id.example.test/device",
    tokenUrl: "https://id.example.test/token",
    clientId: "client",
    scope: "ews offline_access",
  },
};
beforeEach(() => {
  state.values.clear();
  state.polls = 0;
  state.result = "authorization_pending";
  vi.spyOn(Date, "now").mockReturnValue(100_000);
});
afterEach(() => vi.restoreAllMocks());
describe("EWS login sessions", () => {
  it("keeps device and OAuth tokens encrypted and out of browser responses", async () => {
    const result = await startEwsSession("owner", {
      ...config,
      auth: {
        ...config.auth,
        accessToken: "injected",
        refreshToken: "injected",
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret-device");
    const encrypted = [...state.values.values()][0] ?? "";
    expect(encrypted).not.toContain("secret-device");
    expect(decryptPassword(encrypted, state.key)).toContain("secret-device");
    expect(decryptPassword(encrypted, state.key)).not.toContain("injected");
  });
  it("does not allow another Keeper user to poll or reuse the session", async () => {
    const { sessionId } = await startEwsSession("owner", config);
    await expect(pollEwsSession("other", sessionId)).rejects.toThrow();
    await expect(resolveEwsRequest("other", { sessionId })).rejects.toThrow();
    expect(state.polls).toBe(0);
  });
  it("enforces poll timing and the slow_down response", async () => {
    const { sessionId } = await startEwsSession("owner", config);
    await pollEwsSession("owner", sessionId);
    expect(state.polls).toBe(0);
    vi.mocked(Date.now).mockReturnValue(105_000);
    state.result = "slow_down";
    expect(await pollEwsSession("owner", sessionId)).toEqual({
      authorized: false,
      interval: 10,
    });
    vi.mocked(Date.now).mockReturnValue(110_000);
    await pollEwsSession("owner", sessionId);
    expect(state.polls).toBe(1);
  });
  it("blocks connection before authorization and browser-supplied user tokens", async () => {
    const { sessionId } = await startEwsSession("owner", config);
    await expect(resolveEwsRequest("owner", { sessionId })).rejects.toThrow();
    await expect(resolveEwsRequest("owner", { config })).rejects.toThrow(
      "Use the user sign-in flow",
    );
  });
  it("uses only the authorized server config and provides tokens server-side", async () => {
    const { sessionId } = await startEwsSession("owner", config);
    vi.mocked(Date.now).mockReturnValue(105_000);
    state.result = "authorized";
    expect(await pollEwsSession("owner", sessionId)).toEqual({
      authorized: true,
      interval: 5,
    });
    const resolved = await resolveEwsRequest("owner", {
      sessionId,
      config: { serverUrl: "https://attacker.example.test" },
    });
    expect(resolved.config.serverUrl).toBe(config.serverUrl);
    expect(await resolved.runtime.getAccessToken?.(resolved.config)).toBe(
      "secret-access",
    );
    await removeEwsSession("owner", sessionId);
    await expect(resolveEwsRequest("owner", { sessionId })).rejects.toThrow();
  });
  it("rejects expired sessions even if the backing store has not evicted them", async () => {
    const { sessionId } = await startEwsSession("owner", config);
    vi.mocked(Date.now).mockReturnValue(2_000_000);
    await expect(pollEwsSession("owner", sessionId)).rejects.toThrow("expired");
  });
});
