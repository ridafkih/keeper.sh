import { afterAll, describe, expect, it } from "vitest";
import { revokeGoogleGrant } from "../../../src/core/oauth/google";

const slowProvider = Bun.serve({
  fetch: async () => {
    await Bun.sleep(1200);
    return new Response("{}", { status: 200 });
  },
  port: 0,
});

const silentProvider = Bun.serve({
  fetch: () => new Promise<Response>(() => {}),
  port: 0,
});

afterAll(() => {
  slowProvider.stop(true);
  silentProvider.stop(true);
});

describe("google grant revocation against a slow provider", () => {
  it("revokes when the provider answers after more than a second", async () => {
    const outcome = await revokeGoogleGrant("refresh-token", {
      fetchImpl: (_url, init) => fetch(`http://localhost:${slowProvider.port}/revoke`, init),
    });

    expect(outcome.revoked).toBe(true);
    expect(outcome.status).toBe(200);
  }, 30_000);

  it("still times out when the provider never answers", async () => {
    await expect(
      revokeGoogleGrant("refresh-token", {
        fetchImpl: (_url, init) => fetch(`http://localhost:${silentProvider.port}/revoke`, init),
      }),
    ).rejects.toThrow(/timed out after/i);
  }, 60_000);
});
