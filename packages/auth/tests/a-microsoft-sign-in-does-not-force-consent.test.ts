import { PGlite } from "@electric-sql/pglite";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/index";

const BASE_URL = "http://localhost:3000";

const buildSignInUrl = async (providerId: string): Promise<URL> => {
  const { auth } = createAuth({
    baseUrl: BASE_URL,
    commercialMode: true,
    database: drizzle(new PGlite()) as unknown as BunSQLDatabase,
    googleClientId: "test-google-client-id",
    googleClientSecret: "test-google-client-secret",
    microsoftCredentials: {
      clientId: "test-microsoft-client-id",
      clientSecret: "test-microsoft-client-secret",
      tenant: "common",
    },
    secret: "test-secret-for-microsoft-sign-in-prompt",
  });
  const context = await auth.$context;
  const provider = context.socialProviders.find((candidate) => candidate.id === providerId);
  if (!provider) {
    throw new TypeError(`Social provider ${providerId} is not configured`);
  }
  return provider.createAuthorizationURL({
    codeVerifier: "test-code-verifier-that-is-long-enough-for-pkce-0000",
    redirectURI: `${BASE_URL}/api/auth/callback/${providerId}`,
    state: "test-state",
  });
};

describe("Microsoft sign-in", () => {
  it("lets Microsoft skip the consent screen when an admin already approved the app", async () => {
    const url = await buildSignInUrl("microsoft");

    expect(url.searchParams.get("prompt")).not.toBe("consent");
  });

  it("still lets the user pick which Microsoft account to sign in with", async () => {
    const url = await buildSignInUrl("microsoft");

    expect(url.searchParams.get("prompt")).toBe("select_account");
  });
});
