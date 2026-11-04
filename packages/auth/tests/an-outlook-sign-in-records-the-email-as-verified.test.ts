import { PGlite } from "@electric-sql/pglite";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/index";

const BASE_URL = "http://localhost:3000";
const SECRET = "test-secret-for-outlook-sign-in-email-verification";
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

const encodeSegment = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const buildIdToken = (claims: Record<string, unknown>) =>
  `${encodeSegment({ alg: "RS256", kid: "test-kid", typ: "JWT" })}.${encodeSegment(claims)}.signature`;

const createHostedAuth = async (
  microsoftTenantId?: string,
  microsoftAuthPrompt?: "consent" | "select_account",
) => {
  const client = new PGlite();
  clients.push(client);
  await client.exec(AUTH_DDL);

  const database = drizzle(client);
  const { auth } = createAuth({
    baseUrl: BASE_URL,
    commercialMode: true,
    database: database as unknown as BunSQLDatabase,
    googleClientId: "test-google-client-id",
    googleClientSecret: "test-google-client-secret",
    microsoftClientId: "test-microsoft-client-id",
    microsoftClientSecret: "test-microsoft-client-secret",
    microsoftTenantId,
    microsoftAuthPrompt,
    secret: SECRET,
  });

  return auth;
};

const mapSocialProfile = async (
  auth: Awaited<ReturnType<typeof createHostedAuth>>,
  providerId: string,
  claims: Record<string, unknown>,
) => {
  const context = await auth.$context;
  const provider = context.socialProviders.find(
    (candidate) => candidate.id === providerId,
  );

  if (!provider) {
    throw new TypeError(`Social provider ${providerId} is not configured`);
  }

  const profile = await provider.getUserInfo({
    accessToken: "test-access-token",
    idToken: buildIdToken(claims),
  } as never);

  if (!profile) {
    throw new TypeError(`Social provider ${providerId} returned no profile`);
  }

  return profile.user;
};

type FetchInput = Parameters<typeof fetch>[0];
type FetchFunction = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

const readFetchUrl = (input: FetchInput): string => {
  if (input instanceof Request) {
    return input.url;
  }

  return String(input);
};

const stubGraphPhotoFetch = () => {
  const realFetch = globalThis.fetch;

  vi.stubGlobal("fetch", (input: FetchInput, init?: RequestInit) => {
    if (readFetchUrl(input).startsWith("https://graph.microsoft.com/")) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }

    return realFetch(input, init);
  });
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("an Outlook sign-in", () => {
  it.each<{ tenantId?: string; authority: string }>([
    { authority: "common" },
    { tenantId: " ABCDEF01-2345-6789-ABCD-EF0123456789 ", authority: "abcdef01-2345-6789-abcd-ef0123456789" },
  ])("exchanges and refreshes sign-in tokens using $authority", async ({ tenantId, authority }) => {
    const fetchMock = vi.fn<FetchFunction>(() => Promise.resolve(Response.json({
      access_token: "access-token",
      expires_in: 3600,
      refresh_token: "refresh-token",
      scope: "openid profile email User.Read offline_access Calendars.ReadWrite",
      token_type: "Bearer",
    })));
    vi.stubGlobal("fetch", fetchMock);
    const auth = await createHostedAuth(tenantId);
    const context = await auth.$context;
    const provider = context.socialProviders.find((candidate) => candidate.id === "microsoft");
    if (!provider?.refreshAccessToken) {
      throw new TypeError("Microsoft social provider is not configured");
    }

    await provider.validateAuthorizationCode({
      code: "authorization-code",
      codeVerifier: "test-code-verifier",
      redirectURI: `${BASE_URL}/api/auth/callback/microsoft`,
    });
    await provider.refreshAccessToken("refresh-token");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [input] of fetchMock.mock.calls) {
      expect(String(input)).toBe(`https://login.microsoftonline.com/${authority}/oauth2/v2.0/token`);
    }
  });

  describe.each([{}, { tenantId: "abcdef01-2345-6789-abcd-ef0123456789" }])("with authority %j", ({ tenantId }) => {
    it.each<{ prompt?: "consent" | "select_account" }>([
      {},
      { prompt: "consent" },
      { prompt: "select_account" },
    ])("uses the configured sign-in prompt %j", async ({ prompt }) => {
      const auth = await createHostedAuth(tenantId, prompt);
      const context = await auth.$context;
      const provider = context.socialProviders.find((candidate) => candidate.id === "microsoft");

      if (!provider) {
        throw new TypeError("Microsoft social provider is not configured");
      }

      const authorizationUrl = await provider.createAuthorizationURL({
        codeVerifier: "test-code-verifier",
        redirectURI: `${BASE_URL}/api/auth/callback/microsoft`,
        state: "test-state",
      });

      expect(authorizationUrl.pathname).toBe(`/${tenantId ?? "common"}/oauth2/v2.0/authorize`);
      expect(authorizationUrl.searchParams.get("prompt")).toBe(prompt ?? "consent");
      expect(authorizationUrl.searchParams.get("scope")?.split(" ")).toEqual(
        expect.arrayContaining(["offline_access", "User.Read", "Calendars.ReadWrite"]),
      );
    });
  });

  it.each<{ tenantId?: string; authority: string }>([
    { authority: "common" },
    { tenantId: "", authority: "common" },
    { tenantId: "  ", authority: "common" },
    { tenantId: " ABCDEF01-2345-6789-ABCD-EF0123456789 ", authority: "abcdef01-2345-6789-abcd-ef0123456789" },
  ])(
    "uses the Microsoft tenant authority for configuration %j",
    async ({ tenantId, authority }) => {
      const auth = await createHostedAuth(tenantId);
      const context = await auth.$context;
      const provider = context.socialProviders.find((candidate) => candidate.id === "microsoft");

      if (!provider) {
        throw new TypeError("Microsoft social provider is not configured");
      }

      const authorizationUrl = await provider.createAuthorizationURL({
        codeVerifier: "test-code-verifier",
        redirectURI: `${BASE_URL}/api/auth/callback/microsoft`,
        state: "test-state",
      });

      expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(
        `https://login.microsoftonline.com/${authority}/oauth2/v2.0/authorize`,
      );
    },
  );

  it("records a personal Microsoft account's email as verified when Entra omits the email_verified claim", async () => {
    stubGraphPhotoFetch();

    const auth = await createHostedAuth();
    const mapped = await mapSocialProfile(auth, "microsoft", {
      email: "new-outlook-customer@keeper.sh",
      name: "New Outlook Customer",
      oid: "entra-object-id",
      sub: "entra-subject",
      tid: "9188040d-6c67-4c5b-b112-36a304b66dad",
    });

    expect(mapped.email).toBe("new-outlook-customer@keeper.sh");
    expect(mapped.emailVerified).toBe(true);
  });

  it("records a work account's email as verified when Entra marks the domain owner verified", async () => {
    stubGraphPhotoFetch();

    const auth = await createHostedAuth();
    const mapped = await mapSocialProfile(auth, "microsoft", {
      email: "domain-verified-customer@keeper.sh",
      name: "Domain Verified Customer",
      oid: "entra-object-id",
      sub: "entra-subject",
      tid: "contoso-tenant",
      xms_edov: true,
    });

    expect(mapped.emailVerified).toBe(true);
  });

  it("leaves a work account's email unverified when Entra asserts nothing about it", async () => {
    stubGraphPhotoFetch();

    const auth = await createHostedAuth();
    const mapped = await mapSocialProfile(auth, "microsoft", {
      email: "unasserted-work-customer@keeper.sh",
      name: "Unasserted Work Customer",
      oid: "entra-object-id",
      sub: "entra-subject",
      tid: "contoso-tenant",
    });

    expect(mapped.emailVerified).toBe(false);
  });

  it("records the email as verified when Entra sends email_verified true", async () => {
    stubGraphPhotoFetch();

    const auth = await createHostedAuth();
    const mapped = await mapSocialProfile(auth, "microsoft", {
      email: "claimed-outlook-customer@keeper.sh",
      email_verified: true,
      name: "Claimed Outlook Customer",
      oid: "entra-object-id",
      sub: "entra-subject",
      tid: "contoso-tenant",
    });

    expect(mapped.emailVerified).toBe(true);
  });

  it("honours an explicit email_verified false from Entra", async () => {
    stubGraphPhotoFetch();

    const auth = await createHostedAuth();
    const mapped = await mapSocialProfile(auth, "microsoft", {
      email: "unconfirmed-outlook-customer@keeper.sh",
      email_verified: false,
      name: "Unconfirmed Outlook Customer",
      oid: "entra-object-id",
      sub: "entra-subject",
      tid: "9188040d-6c67-4c5b-b112-36a304b66dad",
      xms_edov: true,
    });

    expect(mapped.emailVerified).toBe(false);
  });

  it("records the email as verified when Entra names it among the verified primary addresses", async () => {
    stubGraphPhotoFetch();

    const auth = await createHostedAuth();
    const mapped = await mapSocialProfile(auth, "microsoft", {
      email: "primary-outlook-customer@keeper.sh",
      name: "Primary Outlook Customer",
      oid: "entra-object-id",
      sub: "entra-subject",
      tid: "contoso-tenant",
      verified_primary_email: ["primary-outlook-customer@keeper.sh"],
    });

    expect(mapped.emailVerified).toBe(true);
  });
});

describe("a Google sign-in", () => {
  it("keeps requesting consent when Microsoft uses the account picker", async () => {
    const auth = await createHostedAuth("abcdef01-2345-6789-abcd-ef0123456789", "select_account");
    const context = await auth.$context;
    const provider = context.socialProviders.find((candidate) => candidate.id === "google");

    if (!provider) {
      throw new TypeError("Google social provider is not configured");
    }

    const authorizationUrl = await provider.createAuthorizationURL({
      codeVerifier: "test-code-verifier",
      redirectURI: `${BASE_URL}/api/auth/callback/google`,
      state: "test-state",
    });

    expect(authorizationUrl.searchParams.get("prompt")).toBe("consent");
    expect(authorizationUrl.searchParams.get("access_type")).toBe("offline");
  });

  it("still follows the email_verified claim Google always sends", async () => {
    const auth = await createHostedAuth();

    const verified = await mapSocialProfile(auth, "google", {
      email: "google-customer@keeper.sh",
      email_verified: true,
      name: "Google Customer",
      sub: "google-subject",
    });
    expect(verified.emailVerified).toBe(true);

    const unverified = await mapSocialProfile(auth, "google", {
      email: "unconfirmed-google-customer@keeper.sh",
      email_verified: false,
      name: "Unconfirmed Google Customer",
      sub: "google-subject",
    });
    expect(unverified.emailVerified).toBe(false);
  });
});
