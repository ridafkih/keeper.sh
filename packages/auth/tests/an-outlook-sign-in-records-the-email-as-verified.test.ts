import { PGlite } from "@electric-sql/pglite";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/index";

const BASE_URL = "http://localhost:3000";
const SECRET = "test-secret-for-outlook-sign-in-email-verification";

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

const createHostedAuth = async () => {
  const client = new PGlite();
  await client.exec(AUTH_DDL);

  const database = drizzle(client);
  const { auth } = createAuth({
    deleteUserResidueRecorder: async () => {},
    deleteUserTeardown: async () => {},
    deleteUserTeardownRollback: async () => {},
    baseUrl: BASE_URL,
    commercialMode: true,
    database: database as unknown as BunSQLDatabase,
    googleClientId: "test-google-client-id",
    googleClientSecret: "test-google-client-secret",
    microsoftClientId: "test-microsoft-client-id",
    microsoftClientSecret: "test-microsoft-client-secret",
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an Outlook sign-in", () => {
  it("records the email as verified when Entra omits the email_verified claim", async () => {
    stubGraphPhotoFetch();

    const auth = await createHostedAuth();
    const mapped = await mapSocialProfile(auth, "microsoft", {
      email: "new-outlook-customer@keeper.sh",
      name: "New Outlook Customer",
      oid: "entra-object-id",
      sub: "entra-subject",
      tid: "contoso-tenant",
    });

    expect(mapped.email).toBe("new-outlook-customer@keeper.sh");
    expect(mapped.emailVerified).toBe(true);
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
      tid: "contoso-tenant",
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
