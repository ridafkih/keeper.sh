import { describe, expect, it } from "vitest";
import {
  COMPANION_COOKIE_NAME,
  createSessionCookies,
  isNullSession,
} from "../../src/utils/session-cookies";
import type { SessionCookieSet } from "../../src/utils/session-cookies";

const SESSION_PATHNAME = "/api/auth/get-session";
const SESSION_MAX_AGE_SECONDS = 604_800;
const SESSION_EXPIRES_AT = "2026-11-30T22:02:34.000Z";

const secureCookies: SessionCookieSet = {
  sessionData: {
    attributes: { httpOnly: true, path: "/", sameSite: "lax", secure: true },
    name: "__Secure-better-auth.session_data",
  },
  sessionToken: {
    attributes: {
      httpOnly: true,
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: true,
    },
    name: "__Secure-better-auth.session_token",
  },
};

const plainCookies: SessionCookieSet = {
  sessionData: {
    attributes: { httpOnly: true, path: "/", sameSite: "lax", secure: false },
    name: "better-auth.session_data",
  },
  sessionToken: {
    attributes: {
      httpOnly: true,
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: false,
    },
    name: "better-auth.session_token",
  },
};

const respondWith = (body: unknown, setCookies: string[] = []): Response => {
  const response = Response.json(body);
  for (const cookie of setCookies) {
    response.headers.append("Set-Cookie", cookie);
  }
  return response;
};

const browserRequest = (cookie = ""): Request =>
  new Request("https://keeper.example.com/api/auth/get-session", { headers: { cookie } });

const finalize = async (
  cookies: SessionCookieSet,
  response: Response,
  pathname = SESSION_PATHNAME,
  request = browserRequest(),
): Promise<string[]> => {
  const finalized = await createSessionCookies(cookies).finalizeAuthResponse(
    pathname,
    request,
    response,
  );
  return finalized.headers.getSetCookie();
};

const requestWith = (cookie: string): Request =>
  new Request("https://keeper.example.com/api/auth/oauth2/register", { headers: { cookie } });

describe("isNullSession", () => {
  it("accepts a null body", () => {
    expect(isNullSession(null)).toBe(true);
  });

  it("accepts a body whose session is null", () => {
    expect(isNullSession({ session: null })).toBe(true);
  });

  it("rejects a body with a session", () => {
    expect(isNullSession({ session: { id: "abc" } })).toBe(false);
  });

  it("rejects a body without a session key", () => {
    expect(isNullSession({ user: "test" })).toBe(false);
  });

  it("rejects values that are not objects", () => {
    expect(isNullSession("string")).toBe(false);
    expect(isNullSession(42)).toBe(false);
    expect(isNullSession(globalThis.undefined)).toBe(false);
  });
});

describe("companion cookie", () => {
  it("is set next to a new session cookie, marked Secure when the session cookie is", async () => {
    const setCookies = await finalize(
      secureCookies,
      respondWith({}, ["__Secure-better-auth.session_token=abc; Path=/; HttpOnly; Secure; SameSite=Lax"]),
      "/api/auth/sign-in/email",
    );

    expect(setCookies.at(-1)).toBe(
      `${COMPANION_COOKIE_NAME}=1; Max-Age=604800; Path=/; Secure; SameSite=Lax`,
    );
  });

  it("is set without Secure when the session cookie is not Secure", async () => {
    const setCookies = await finalize(
      plainCookies,
      respondWith({}, ["better-auth.session_token=abc; Path=/; HttpOnly; SameSite=Lax"]),
      "/api/auth/sign-in/email",
    );

    expect(setCookies.at(-1)).toBe(`${COMPANION_COOKIE_NAME}=1; Max-Age=604800; Path=/; SameSite=Lax`);
  });

  it("lives as long as the session cookie, so it survives a browser restart", async () => {
    const setCookies = await finalize(
      secureCookies,
      respondWith({}, [
        "__Secure-better-auth.session_token=abc; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax",
      ]),
      "/api/auth/callback/google",
    );

    expect(setCookies.at(-1)).toContain("Max-Age=604800");
  });

  it("is a browser-session cookie only when the session cookie is one too", async () => {
    const setCookies = await finalize(
      {
        sessionData: plainCookies.sessionData,
        sessionToken: {
          attributes: { httpOnly: true, path: "/", sameSite: "lax", secure: false },
          name: plainCookies.sessionToken.name,
        },
      },
      respondWith({}, ["better-auth.session_token=abc; Path=/; HttpOnly; SameSite=Lax"]),
      "/api/auth/sign-in/email",
    );

    expect(setCookies.at(-1)).toBe(`${COMPANION_COOKIE_NAME}=1; Path=/; SameSite=Lax`);
  });

  it("is never HttpOnly, because the page reads it", async () => {
    const setCookies = await finalize(
      secureCookies,
      respondWith({}, ["__Secure-better-auth.session_token=abc; Path=/; HttpOnly; Secure; SameSite=Lax"]),
      "/api/auth/sign-in/email",
    );

    expect(setCookies.at(-1)).not.toContain("HttpOnly");
  });

  it("is cleared next to a cleared session cookie", async () => {
    const setCookies = await finalize(
      secureCookies,
      respondWith({}, ["__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax"]),
      "/api/auth/sign-out",
    );

    expect(setCookies.at(-1)).toBe(
      `${COMPANION_COOKIE_NAME}=; Max-Age=0; Path=/; Secure; SameSite=Lax`,
    );
  });

  it("is left alone when a response does not touch the session cookie", async () => {
    const setCookies = await finalize(
      secureCookies,
      respondWith({}, ["other_cookie=value; Path=/"]),
      "/api/auth/list-accounts",
    );

    expect(setCookies).toEqual(["other_cookie=value; Path=/"]);
  });

  it("ignores a cookie that only shares the end of the session cookie's name", async () => {
    const setCookies = await finalize(
      plainCookies,
      respondWith({}, ["__Secure-better-auth.session_token=abc; Path=/; HttpOnly; Secure; SameSite=Lax"]),
      "/api/auth/list-accounts",
    );

    expect(setCookies).toHaveLength(1);
  });
});

describe("a session read that finds no session", () => {
  it("expires the configured session cookies and the companion with their own attributes", async () => {
    const setCookies = await finalize(secureCookies, respondWith(null));

    expect(setCookies).toEqual([
      "__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
      "__Secure-better-auth.session_data=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
      `${COMPANION_COOKIE_NAME}=; Max-Age=0; Path=/; Secure; SameSite=Lax`,
    ]);
  });

  it("expires the unprefixed cookies without Secure over plain http", async () => {
    const setCookies = await finalize(plainCookies, respondWith(null));

    expect(setCookies).toEqual([
      "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
      "better-auth.session_data=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
      `${COMPANION_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`,
    ]);
  });

  it("carries a configured cookie domain into the expiry", async () => {
    const setCookies = await finalize(
      {
        sessionData: {
          attributes: { ...secureCookies.sessionData.attributes, domain: "example.com" },
          name: secureCookies.sessionData.name,
        },
        sessionToken: {
          attributes: { ...secureCookies.sessionToken.attributes, domain: "example.com" },
          name: secureCookies.sessionToken.name,
        },
      },
      respondWith(null),
    );

    expect(setCookies.every((cookie) => cookie.includes("Domain=example.com"))).toBe(true);
  });

  it("leaves the cookies alone when the session is present and the companion with it", async () => {
    const setCookies = await finalize(
      secureCookies,
      respondWith({ session: { expiresAt: SESSION_EXPIRES_AT, id: "abc" } }),
      SESSION_PATHNAME,
      browserRequest(`__Secure-better-auth.session_token=abc; ${COMPANION_COOKIE_NAME}=1`),
    );

    expect(setCookies).toEqual([]);
  });

  it("leaves other auth responses with a null body alone", async () => {
    const setCookies = await finalize(secureCookies, respondWith(null), "/api/auth/list-accounts");

    expect(setCookies).toEqual([]);
  });

  it("keeps the status and body of the response", async () => {
    const finalized = await createSessionCookies(secureCookies).finalizeAuthResponse(
      SESSION_PATHNAME,
      browserRequest(),
      respondWith(null),
    );

    expect(finalized.status).toBe(200);
    await expect(finalized.json()).resolves.toBeNull();
  });
});

describe("a session read that finds a session the companion has lost", () => {
  it("restores the companion until the session expires", async () => {
    const setCookies = await finalize(
      secureCookies,
      respondWith({ session: { expiresAt: SESSION_EXPIRES_AT, id: "abc" } }),
      SESSION_PATHNAME,
      browserRequest("__Secure-better-auth.session_token=abc"),
    );

    expect(setCookies).toEqual([
      `${COMPANION_COOKIE_NAME}=1; Expires=Mon, 30 Nov 2026 22:02:34 GMT; Path=/; Secure; SameSite=Lax`,
    ]);
  });

  it("does not mistake a cookie that only starts with the companion's name for it", async () => {
    const setCookies = await finalize(
      secureCookies,
      respondWith({ session: { expiresAt: SESSION_EXPIRES_AT, id: "abc" } }),
      SESSION_PATHNAME,
      browserRequest(`__Secure-better-auth.session_token=abc; ${COMPANION_COOKIE_NAME}_old=1`),
    );

    expect(setCookies).toHaveLength(1);
  });

  it("leaves the response alone when the session carries no expiry", async () => {
    const setCookies = await finalize(
      secureCookies,
      respondWith({ session: { id: "abc" } }),
      SESSION_PATHNAME,
      browserRequest("__Secure-better-auth.session_token=abc"),
    );

    expect(setCookies).toEqual([]);
  });

  it("leaves other auth responses with a session alone", async () => {
    const setCookies = await finalize(
      secureCookies,
      respondWith({ session: { expiresAt: SESSION_EXPIRES_AT, id: "abc" } }),
      "/api/auth/list-sessions",
      browserRequest("__Secure-better-auth.session_token=abc"),
    );

    expect(setCookies).toEqual([]);
  });
});

describe("hasSessionToken", () => {
  it("finds the configured session cookie among others", () => {
    const { hasSessionToken } = createSessionCookies(secureCookies);

    expect(hasSessionToken(requestWith("theme=dark; __Secure-better-auth.session_token=abc"))).toBe(true);
  });

  it("does not count a cookie under another name as a session", () => {
    const { hasSessionToken } = createSessionCookies(secureCookies);

    expect(hasSessionToken(requestWith("better-auth.session_token=abc"))).toBe(false);
  });

  it("reports no session when the request carries no cookies", () => {
    const { hasSessionToken } = createSessionCookies(secureCookies);

    expect(hasSessionToken(new Request("https://keeper.example.com/"))).toBe(false);
  });
});
