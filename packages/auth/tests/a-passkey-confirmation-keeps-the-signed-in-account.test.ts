import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  passkey as passkeyTable,
  session as sessionTable,
  user as userTable,
} from "@keeper.sh/database/auth-schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/index";

const BASE_URL = "http://localhost:3000";
const RP_ID = "localhost";
const SECRET = "test-secret-for-passkey-confirmation";
const PASSWORD = "a-long-enough-password";
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

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
create table "session" (
  "id" text primary key,
  "createdAt" timestamptz not null default now(),
  "expiresAt" timestamptz not null,
  "ipAddress" text,
  "token" text not null unique,
  "updatedAt" timestamptz not null default now(),
  "userAgent" text,
  "userId" text not null references "user"("id") on delete cascade
);
create table "account" (
  "id" text primary key,
  "accessToken" text,
  "accessTokenExpiresAt" timestamptz,
  "accountId" text not null,
  "createdAt" timestamptz not null default now(),
  "idToken" text,
  "password" text,
  "providerId" text not null,
  "refreshToken" text,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "updatedAt" timestamptz not null default now(),
  "userId" text not null references "user"("id") on delete cascade
);
create table "verification" (
  "id" text primary key,
  "createdAt" timestamptz not null default now(),
  "expiresAt" timestamptz not null,
  "identifier" text not null,
  "updatedAt" timestamptz not null default now(),
  "value" text not null
);
create table "passkey" (
  "id" text primary key,
  "aaguid" text,
  "backedUp" boolean not null,
  "counter" integer not null,
  "createdAt" timestamptz,
  "credentialID" text not null,
  "deviceType" text not null,
  "name" text,
  "publicKey" text not null,
  "transports" text,
  "userId" text not null references "user"("id") on delete cascade
);
`;

const createPasskeyAuth = async () => {
  const client = new PGlite();
  await client.exec(AUTH_DDL);
  const database = drizzle(client);
  const { auth } = createAuth({
    baseUrl: BASE_URL,
    commercialMode: true,
    database: database as unknown as BunSQLDatabase,
    passkeyOrigin: BASE_URL,
    passkeyRpId: RP_ID,
    passkeyRpName: "Keeper.sh",
    secret: SECRET,
  });
  return { auth, database };
};

type PasskeyAuth = Awaited<ReturnType<typeof createPasskeyAuth>>;

const resolveMethod = (body?: object): string => {
  if (body) {
    return "POST";
  }
  return "GET";
};

const request = (
  auth: PasskeyAuth["auth"],
  path: string,
  { body, cookie }: { body?: object; cookie?: string } = {},
) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      ...(body && { body: JSON.stringify(body) }),
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
        ...(cookie && { cookie }),
      },
      method: resolveMethod(body),
    }),
  );

const readCookies = (response: Response): string[] =>
  response.headers.getSetCookie().map((cookie) => cookie.split(";")[0] ?? "");

const joinCookies = (...cookies: string[][]): string => cookies.flat().join("; ");

const signedInUser = async ({ auth, database }: PasskeyAuth, email: string) => {
  await request(auth, "/sign-up/email", { body: { email, name: email, password: PASSWORD } });
  await database.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
  const signIn = await request(auth, "/sign-in/email", { body: { email, password: PASSWORD } });
  const body = (await signIn.json()) as { user: { id: string } };
  return { cookies: readCookies(signIn), userId: body.user.id };
};

const toBase64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

const encodeCoseEs256Key = (publicKey: KeyObject): Uint8Array => {
  const jwk = publicKey.export({ format: "jwk" });
  const x = Buffer.from(jwk.x ?? "", "base64url");
  const y = Buffer.from(jwk.y ?? "", "base64url");
  return Buffer.concat([
    Buffer.from([0xA5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    x,
    Buffer.from([0x22, 0x58, 0x20]),
    y,
  ]);
};

const registerPasskey = async (database: PasskeyAuth["database"], userId: string) => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const credentialId = toBase64Url(Buffer.from(randomUUID()));
  await database.insert(passkeyTable).values({
    backedUp: false,
    counter: 0,
    credentialID: credentialId,
    deviceType: "singleDevice",
    id: randomUUID(),
    publicKey: Buffer.from(encodeCoseEs256Key(publicKey)).toString("base64"),
    userId,
  });
  return { credentialId, privateKey };
};

const assertWithPasskey = (
  passkey: Awaited<ReturnType<typeof registerPasskey>>,
  challenge: string,
) => {
  const clientDataJSON = Buffer.from(
    JSON.stringify({ challenge, crossOrigin: false, origin: BASE_URL, type: "webauthn.get" }),
  );
  const authenticatorData = Buffer.concat([
    createHash("sha256").update(RP_ID).digest(),
    Buffer.from([0x05, 0x00, 0x00, 0x00, 0x01]),
  ]);
  const signature = sign(
    "sha256",
    Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]),
    passkey.privateKey,
  );
  return {
    clientExtensionResults: {},
    id: passkey.credentialId,
    rawId: passkey.credentialId,
    response: {
      authenticatorData: toBase64Url(authenticatorData),
      clientDataJSON: toBase64Url(clientDataJSON),
      signature: toBase64Url(signature),
    },
    type: "public-key",
  };
};

const confirmWithPasskey = async (
  auth: PasskeyAuth["auth"],
  sessionCookies: string[],
  passkey: Awaited<ReturnType<typeof registerPasskey>>,
) => {
  const options = await request(auth, "/passkey/generate-authenticate-options", {
    cookie: joinCookies(sessionCookies),
  });
  const { challenge } = (await options.json()) as { challenge: string };
  return request(auth, "/passkey/verify-authentication", {
    body: { response: assertWithPasskey(passkey, challenge) },
    cookie: joinCookies(sessionCookies, readCookies(options)),
  });
};

const readSessionUserId = async (auth: PasskeyAuth["auth"], cookie: string) => {
  const response = await request(auth, "/get-session", { cookie });
  const body = (await response.json()) as { user: { id: string } } | null;
  return body?.user.id ?? null;
};

const sessionCookieAfter = (sessionCookies: string[], response: Response): string => {
  const replaced = readCookies(response);
  const replacedNames = new Set(replaced.map((cookie) => cookie.split("=")[0]));
  const kept = sessionCookies.filter((cookie) => !replacedNames.has(cookie.split("=")[0]));
  return joinCookies(kept, replaced);
};

describe("confirming it's you with a passkey while signed in", () => {
  it("refuses another account's passkey and leaves the session signed in as you", async () => {
    const keeper = await createPasskeyAuth();
    const you = await signedInUser(keeper, "you@example.com");
    const other = await signedInUser(keeper, "other@example.com");
    const othersPasskey = await registerPasskey(keeper.database, other.userId);

    const response = await confirmWithPasskey(keeper.auth, you.cookies, othersPasskey);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "PASSKEY_BELONGS_TO_ANOTHER_ACCOUNT" });
    const cookieAfter = sessionCookieAfter(you.cookies, response);
    expect(await readSessionUserId(keeper.auth, cookieAfter)).toBe(you.userId);
    const otherSessions = await keeper.database
      .select()
      .from(sessionTable)
      .where(eq(sessionTable.userId, other.userId));
    expect(otherSessions).toHaveLength(1);
  });

  it("accepts your own passkey with a fresh session that can delete the account", async () => {
    const keeper = await createPasskeyAuth();
    const you = await signedInUser(keeper, "you@example.com");
    const yourPasskey = await registerPasskey(keeper.database, you.userId);
    await keeper.database
      .update(sessionTable)
      .set({ createdAt: new Date(Date.now() - TWO_DAYS_MS) });

    const response = await confirmWithPasskey(keeper.auth, you.cookies, yourPasskey);

    expect(response.status).toBe(200);
    const cookieAfter = sessionCookieAfter(you.cookies, response);
    expect(await readSessionUserId(keeper.auth, cookieAfter)).toBe(you.userId);
    const deletion = await request(keeper.auth, "/delete-user", { body: {}, cookie: cookieAfter });
    expect(deletion.status).toBe(200);
  });

  it("still signs a signed-out visitor in with whichever passkey they pick", async () => {
    const keeper = await createPasskeyAuth();
    const other = await signedInUser(keeper, "other@example.com");
    const othersPasskey = await registerPasskey(keeper.database, other.userId);

    const response = await confirmWithPasskey(keeper.auth, [], othersPasskey);

    expect(response.status).toBe(200);
    expect(await readSessionUserId(keeper.auth, joinCookies(readCookies(response)))).toBe(other.userId);
  });
});
