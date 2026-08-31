import { describe, expect, it } from "vitest";
import { revokeGoogleGrant } from "../../../src/core/oauth/google";
import { createSilentProviderFetch } from "../../support/silent-provider-fetch";

const PROVIDER_RESPONSE_DELAY_MS = 1200;

describe("google grant revocation against a slow provider", () => {
  it("revokes when the provider answers after more than a second", async () => {
    const outcome = await revokeGoogleGrant("refresh-token", {
      fetchImpl: async (_url, init) => {
        if (!init.signal) {
          throw new Error("grant revocation issued a request that carried no abort signal");
        }
        await Bun.sleep(PROVIDER_RESPONSE_DELAY_MS);
        init.signal.throwIfAborted();
        return new Response("{}", { status: 200 });
      },
    });

    expect(outcome.revoked).toBe(true);
    expect(outcome.status).toBe(200);
  }, 30_000);

  it("still times out when the provider never answers", async () => {
    const silentProviderFetch = createSilentProviderFetch();

    await expect(
      revokeGoogleGrant("refresh-token", {
        fetchImpl: (url, init) => silentProviderFetch(url, init),
      }),
    ).rejects.toThrow(/timed out after/i);
  }, 60_000);
});
