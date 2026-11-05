import { PGlite } from "@electric-sql/pglite";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { microsoftDirectoryTenantSchema } from "@keeper.sh/data-schemas";
import type { MicrosoftDirectoryTenant } from "@keeper.sh/data-schemas";
import { createAuth } from "../src/index";

const BASE_URL = "http://localhost:3000";
const SECRET = "test-secret-for-microsoft-sign-in-tenant";
const REDIRECT_URI = `${BASE_URL}/api/auth/callback/microsoft`;
const DIRECTORY_TENANT = microsoftDirectoryTenantSchema.assert("abcdef01-2345-6789-abcd-ef0123456789");
const clients: PGlite[] = [];

const AUTH_DDL = `
create table "user" (
  "id" text primary key,
  "createdAt" timestamptz not null default now(),
  "email" text not null unique,
  "emailVerified" boolean not null default false,
  "image" text,
  "name" text not null,
  "updatedAt" timestamptz not null default now(),
  "username" text unique
);
`;

type FetchFunction = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

const createMicrosoftProvider = async (tenant: MicrosoftDirectoryTenant) => {
  const client = new PGlite();
  clients.push(client);
  await client.exec(AUTH_DDL);

  const { auth } = createAuth({
    baseUrl: BASE_URL,
    commercialMode: true,
    database: drizzle(client) as unknown as BunSQLDatabase,
    microsoftCredentials: {
      clientId: "test-microsoft-client-id",
      clientSecret: "test-microsoft-client-secret",
      tenant,
    },
    secret: SECRET,
  });

  const context = await auth.$context;
  const provider = context.socialProviders.find((candidate) => candidate.id === "microsoft");

  if (!provider?.refreshAccessToken) {
    throw new TypeError("Microsoft social provider is not configured");
  }

  return { ...provider, refreshAccessToken: provider.refreshAccessToken };
};

const stubTokenEndpoint = () => {
  const fetchMock = vi.fn<FetchFunction>(() => Promise.resolve(Response.json({
    access_token: "access-token",
    expires_in: 3600,
    refresh_token: "refresh-token",
    scope: "openid profile email User.Read offline_access Calendars.ReadWrite",
    token_type: "Bearer",
  })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe.each<{ description: string; tenant: MicrosoftDirectoryTenant }>([
  { description: "with the common tenant", tenant: "common" },
  { description: "with a directory tenant", tenant: DIRECTORY_TENANT },
])("a Microsoft sign-in $description", ({ tenant }) => {
  it(`sends the user to the ${tenant} authorize endpoint`, async () => {
    const provider = await createMicrosoftProvider(tenant);

    const authorizationUrl = await provider.createAuthorizationURL({
      codeVerifier: "test-code-verifier",
      redirectURI: REDIRECT_URI,
      state: "test-state",
    });

    expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    );
  });

  it(`exchanges and refreshes tokens at the ${tenant} token endpoint`, async () => {
    const fetchMock = stubTokenEndpoint();
    const provider = await createMicrosoftProvider(tenant);

    await provider.validateAuthorizationCode({
      code: "authorization-code",
      codeVerifier: "test-code-verifier",
      redirectURI: REDIRECT_URI,
    });
    await provider.refreshAccessToken("refresh-token");

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    ]);
  });
});
