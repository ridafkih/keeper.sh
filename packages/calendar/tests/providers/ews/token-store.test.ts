import { describe, it, expect, vi } from "vitest";
import { decryptPassword, encryptPassword } from "@keeper.sh/database";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { createEwsTokenProvider } from "../../../src/providers/ews/token-store";
import { parseEwsConfig } from "../../../src/providers/ews/config";
const key = Buffer.alloc(32, 8).toString("base64");
const config = () =>
  parseEwsConfig({
    serverUrl: "https://ews.example.test/service",
    mailbox: "user@example.test",
    auth: {
      type: "oauth2-user",
      deviceAuthorizationUrl: "https://id.example.test/device",
      tokenUrl: "https://id.example.test/token",
      clientId: "client",
      scope: "ews offline_access",
      refreshToken: "old-refresh",
    },
  });
const fixture = () => {
  const state = {
    encryptedConfig: encryptPassword(JSON.stringify(config()), key),
    writes: 0,
  };
  let queue = Promise.resolve(null);
  const lock = vi.fn(() => ({
    limit: () => Promise.resolve([{ encryptedConfig: state.encryptedConfig }]),
  }));
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: lock }) }) }),
    update: () => ({
      set: (data: { encryptedConfig: string }) => ({
        where: () => {
          state.encryptedConfig = data.encryptedConfig;
          state.writes += 1;
          return Promise.resolve();
        },
      }),
    }),
  };
  const database = {
    transaction: (run: (input: typeof tx) => Promise<string>) => {
      const result = queue.then(() => run(tx));
      queue = result.then(
        () => null,
        () => null,
      );
      return result;
    },
  } as unknown as BunSQLDatabase;
  return { database, state, lock };
};
describe("EWS persisted token rotation", () => {
  it("serializes concurrent refreshes and stores the rotated tokens encrypted", async () => {
    const { database, state, lock } = fixture();
    const fetch = vi.fn(() =>
      Promise.resolve(
        Response.json({
          access_token: "new-access",
          refresh_token: "rotated-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      ),
    );
    const provider = createEwsTokenProvider(database, "account", key, {
      fetch,
    });
    expect(await Promise.all([provider(config()), provider(config())])).toEqual(
      ["new-access", "new-access"],
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledWith("update");
    expect(state.writes).toBe(1);
    expect(state.encryptedConfig).not.toContain("rotated-refresh");
    expect(
      JSON.parse(decryptPassword(state.encryptedConfig, key)).auth.refreshToken,
    ).toBe("rotated-refresh");
  });
  it("does not send refreshed credentials to a stale or changed destination", async () => {
    const { database } = fixture();
    const fetch = vi.fn();
    const expected = config();
    expected.serverUrl = "https://different.example.test/ews";
    await expect(
      createEwsTokenProvider(database, "account", key, { fetch })(expected),
    ).rejects.toThrow("ConnectionChanged");
    expect(fetch).not.toHaveBeenCalled();
  });
});
