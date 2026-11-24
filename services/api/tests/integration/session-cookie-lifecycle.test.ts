import { PGlite } from "@electric-sql/pglite";
import { createAuth } from "@keeper.sh/auth";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { createSessionCookies } from "../../src/utils/session-cookies";

const SECRET = "test-secret-for-session-cookie-lifecycle";
const COMPANION_COOKIE = "keeper.has_session";

const AUTH_DDL = `
create table "user" (
  "id" text primary key,
  "agentFeedbackEnabled" boolean not null default true,
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
`;

interface StoredCookie {
  httpOnly: boolean;
  persistent: boolean;
  path: string;
  sameSite: string | null;
  secure: boolean;
  value: string;
}

interface Browser {
  cookieHeader: () => string;
  forget: (name: string) => void;
  names: () => string[];
  read: (name: string) => StoredCookie | null;
  receive: (response: Response) => void;
  restart: () => void;
  store: (name: string, cookie: StoredCookie) => void;
}

const readAttribute = (attributes: string[], name: string): string | null => {
  const prefix = `${name.toLowerCase()}=`;
  const match = attributes.find((attribute) => attribute.toLowerCase().startsWith(prefix));
  if (!match) {
    return null;
  }
  return match.slice(prefix.length);
};

const createBrowser = (origin: string): Browser => {
  const cookies = new Map<string, StoredCookie>();
  const secureOrigin = origin.startsWith("https://");

  const accept = (setCookie: string): void => {
    const [pair = "", ...attributes] = setCookie.split(";").map((part) => part.trim());
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const flags = new Set(attributes.map((attribute) => attribute.toLowerCase()));
    const secure = flags.has("secure");

    if (secure && !secureOrigin) {
      return;
    }
    if (name.startsWith("__Secure-") && !secure) {
      return;
    }
    if (cookies.get(name)?.secure && !secure) {
      return;
    }
    if (readAttribute(attributes, "Max-Age") === "0") {
      cookies.delete(name);
      return;
    }

    cookies.set(name, {
      httpOnly: flags.has("httponly"),
      persistent:
        readAttribute(attributes, "Max-Age") !== null || readAttribute(attributes, "Expires") !== null,
      path: readAttribute(attributes, "Path") ?? "/",
      sameSite: readAttribute(attributes, "SameSite"),
      secure,
      value: pair.slice(separator + 1),
    });
  };

  return {
    cookieHeader: () =>
      [...cookies.entries()].map(([name, { value }]) => `${name}=${value}`).join("; "),
    forget: (name) => {
      cookies.delete(name);
    },
    names: () => [...cookies.keys()].toSorted(),
    read: (name) => cookies.get(name) ?? null,
    receive: (response) => {
      for (const setCookie of response.headers.getSetCookie()) {
        accept(setCookie);
      }
    },
    restart: () => {
      for (const [name, cookie] of cookies) {
        if (!cookie.persistent) {
          cookies.delete(name);
        }
      }
    },
    store: (name, cookie) => {
      cookies.set(name, cookie);
    },
  };
};

const createSite = async (baseUrl: string) => {
  const client = new PGlite();
  await client.exec(AUTH_DDL);

  const { auth } = createAuth({
    baseUrl,
    commercialMode: false,
    database: drizzle(client) as unknown as BunSQLDatabase,
    secret: SECRET,
  });
  const { authCookies } = await auth.$context;
  const sessionCookies = createSessionCookies(authCookies);
  const browser = createBrowser(baseUrl);

  const request = async (pathname: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("origin", baseUrl);
    const cookieHeader = browser.cookieHeader();
    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }
    const authRequest = new Request(`${baseUrl}${pathname}`, { ...init, headers });
    const response = await sessionCookies.finalizeAuthResponse(
      pathname,
      authRequest,
      await auth.handler(authRequest),
    );
    browser.receive(response);
    return response;
  };

  const signUp = (): Promise<Response> =>
    request("/api/auth/username-only/sign-up", {
      body: JSON.stringify({ password: "a-long-enough-password", username: "calendar-owner" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

  const readSession = async (): Promise<unknown> => {
    const response = await request("/api/auth/get-session");
    return response.json();
  };

  const signOut = (): Promise<Response> =>
    request("/api/auth/sign-out", {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    });

  const endEverySession = async (): Promise<void> => {
    await client.exec("delete from \"session\"");
  };

  return { authCookies, browser, endEverySession, readSession, signOut, signUp };
};

const sites = [
  {
    baseUrl: "https://keeper.example.com",
    label: "an https origin",
    secure: true,
    sessionCookie: "__Secure-better-auth.session_token",
  },
  {
    baseUrl: "http://localhost:3000",
    label: "local http development",
    secure: false,
    sessionCookie: "better-auth.session_token",
  },
];

describe.each(sites)("session cookies on $label", ({ baseUrl, secure, sessionCookie }) => {
  it("names the session cookie the way the auth configuration says", async () => {
    const { authCookies } = await createSite(baseUrl);

    expect(authCookies.sessionToken.name).toBe(sessionCookie);
    expect(authCookies.sessionToken.attributes).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure,
    });
  });

  it("signs a browser in with a session cookie and the companion cookie", async () => {
    const { browser, readSession, signUp } = await createSite(baseUrl);

    const response = await signUp();

    expect(response.status).toBe(200);
    expect(browser.read(sessionCookie)).toMatchObject({ httpOnly: true, sameSite: "Lax", secure });
    expect(browser.read(COMPANION_COOKIE)).toMatchObject({
      httpOnly: false,
      path: "/",
      sameSite: "Lax",
      secure,
      value: "1",
    });
    await expect(readSession()).resolves.toMatchObject({ user: { username: "calendar-owner" } });
  });

  it("leaves the browser with no cookies after signing out", async () => {
    const { browser, readSession, signOut, signUp } = await createSite(baseUrl);
    await signUp();

    const response = await signOut();

    expect(response.status).toBe(200);
    expect(browser.names()).toEqual([]);
    await expect(readSession()).resolves.toBeNull();
  });

  it("clears the browser when its session has ended on the server", async () => {
    const { browser, endEverySession, readSession, signUp } = await createSite(baseUrl);
    await signUp();
    await endEverySession();

    await expect(readSession()).resolves.toBeNull();

    expect(browser.names()).toEqual([]);
  });

  it("clears a session cookie whose signature no longer verifies", async () => {
    const { browser, readSession, signUp } = await createSite(baseUrl);
    await signUp();
    const issued = browser.read(sessionCookie);
    if (!issued) {
      throw new Error("Expected the browser to hold a session cookie");
    }
    browser.store(sessionCookie, { ...issued, value: "forged-token.forged-signature" });

    await expect(readSession()).resolves.toBeNull();

    expect(browser.names()).toEqual([]);
  });

  it("keeps both cookies across a browser restart, which drops cookies without a lifetime", async () => {
    const { browser, readSession, signUp } = await createSite(baseUrl);
    await signUp();

    browser.restart();

    expect(browser.names()).toEqual([COMPANION_COOKIE, sessionCookie].toSorted());
    await expect(readSession()).resolves.toMatchObject({ user: { username: "calendar-owner" } });
  });

  it("restores a lost companion cookie on the next session read", async () => {
    const { browser, readSession, signUp } = await createSite(baseUrl);
    await signUp();
    browser.forget(COMPANION_COOKIE);
    expect(browser.names()).toEqual([sessionCookie]);

    await readSession();

    expect(browser.read(COMPANION_COOKIE)).toMatchObject({ persistent: true, value: "1" });
  });

  it("stays signed in across session reads", async () => {
    const { browser, readSession, signUp } = await createSite(baseUrl);
    await signUp();

    await readSession();
    await readSession();

    expect(browser.names()).toEqual([COMPANION_COOKIE, sessionCookie].toSorted());
  });
});
