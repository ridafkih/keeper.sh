import { PGlite } from "@electric-sql/pglite";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/index";

const BASE_URL = "http://localhost:3000";

const VERIFICATION_DDL = `
create table "verification" (
  "id" text primary key,
  "createdAt" timestamptz not null default now(),
  "expiresAt" timestamptz not null,
  "identifier" text not null,
  "updatedAt" timestamptz not null default now(),
  "value" text not null
);
`;

const createSocialAuth = async () => {
  const client = new PGlite();
  await client.exec(VERIFICATION_DDL);
  const { auth } = createAuth({
    baseUrl: BASE_URL,
    commercialMode: true,
    database: drizzle(client) as unknown as BunSQLDatabase,
    googleClientId: "test-google-client-id",
    googleClientSecret: "test-google-client-secret",
    microsoftCredentials: {
      clientId: "test-microsoft-client-id",
      clientSecret: "test-microsoft-client-secret",
      tenant: "common",
    },
    secret: "test-secret-for-social-sign-in-scopes",
  });
  return auth;
};

const readAuthorizationUrl = async (provider: "google" | "microsoft"): Promise<URL> => {
  const auth = await createSocialAuth();
  const result = await auth.api.signInSocial({
    body: { callbackURL: "/dashboard", provider },
  });
  if (!result.url) {
    throw new Error(`No authorization url for ${provider}`);
  }
  return new URL(result.url);
};

const readScopes = (url: URL): string[] => (url.searchParams.get("scope") ?? "").split(" ");

describe("social sign-in", () => {
  it("asks Google only for the identity needed to sign in", async () => {
    const url = await readAuthorizationUrl("google");

    expect(readScopes(url).toSorted()).toEqual(["email", "openid", "profile"]);
    expect(url.searchParams.get("prompt")).not.toBe("consent");
  });

  it("asks Microsoft only for the identity needed to sign in", async () => {
    const url = await readAuthorizationUrl("microsoft");

    expect(readScopes(url)).not.toContain("Calendars.ReadWrite");
    expect(url.searchParams.get("prompt")).not.toBe("consent");
  });
});
