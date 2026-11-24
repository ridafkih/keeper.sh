interface SessionCookieAttributes {
  domain?: string;
  httpOnly?: boolean;
  maxAge?: number;
  partitioned?: boolean;
  path?: string;
  sameSite?: string;
  secure?: boolean;
}

interface SessionCookie {
  attributes: SessionCookieAttributes;
  name: string;
}

interface SessionCookieSet {
  sessionData: SessionCookie;
  sessionToken: SessionCookie;
}

interface SessionCookies {
  finalizeAuthResponse: (
    pathname: string,
    request: Request,
    response: Response,
  ) => Promise<Response>;
  hasSessionToken: (request: Request) => boolean;
}

const COMPANION_COOKIE_NAME = "keeper.has_session";
const EXPIRED_ATTRIBUTE = "Max-Age=0";
const SESSION_PATHNAME = "/api/auth/get-session";

const formatSameSite = (sameSite: string): string =>
  `${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1).toLowerCase()}`;

const serializeAttributes = (attributes: SessionCookieAttributes): string[] => {
  const serialized = [`Path=${attributes.path ?? "/"}`];
  if (attributes.domain) {
    serialized.push(`Domain=${attributes.domain}`);
  }
  if (attributes.httpOnly) {
    serialized.push("HttpOnly");
  }
  if (attributes.secure) {
    serialized.push("Secure");
  }
  if (attributes.sameSite) {
    serialized.push(`SameSite=${formatSameSite(attributes.sameSite)}`);
  }
  if (attributes.partitioned) {
    serialized.push("Partitioned");
  }
  return serialized;
};

const serializeMaxAge = (attributes: SessionCookieAttributes): string[] => {
  if (typeof attributes.maxAge !== "number") {
    return [];
  }
  return [`Max-Age=${Math.floor(attributes.maxAge)}`];
};

const serializeCookie = (cookie: SessionCookie, value: string): string =>
  [
    `${cookie.name}=${value}`,
    ...serializeMaxAge(cookie.attributes),
    ...serializeAttributes(cookie.attributes),
  ].join("; ");

const serializeCookieUntil = (cookie: SessionCookie, value: string, expiresAt: Date): string =>
  [
    `${cookie.name}=${value}`,
    `Expires=${expiresAt.toUTCString()}`,
    ...serializeAttributes(cookie.attributes),
  ].join("; ");

const serializeExpiredCookie = (cookie: SessionCookie): string =>
  [`${cookie.name}=`, EXPIRED_ATTRIBUTE, ...serializeAttributes(cookie.attributes)].join("; ");

const toCompanionCookie = (sessionToken: SessionCookie): SessionCookie => ({
  attributes: { ...sessionToken.attributes, httpOnly: false },
  name: COMPANION_COOKIE_NAME,
});

const isNullSession = (body: unknown): body is null | { session: null } => {
  if (body === null) {
    return true;
  }
  if (typeof body !== "object") {
    return false;
  }
  if (!("session" in body)) {
    return false;
  }
  return body.session === null;
};

const readSessionExpiry = (body: unknown): Date | null => {
  if (typeof body !== "object" || body === null || !("session" in body)) {
    return null;
  }
  const { session } = body;
  if (typeof session !== "object" || session === null || !("expiresAt" in session)) {
    return null;
  }
  const { expiresAt } = session;
  if (typeof expiresAt !== "string" && !(expiresAt instanceof Date)) {
    return null;
  }
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) {
    return null;
  }
  return expiry;
};

const readRequestCookieNames = (request: Request): string[] =>
  (request.headers.get("cookie") ?? "")
    .split(";")
    .map((cookie) => cookie.split("=", 1)[0]?.trim() ?? "")
    .filter((name) => name.length > 0);

const withCookies = (response: Response, cookies: string[]): Response => {
  const headers = new Headers(response.headers);
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

const createSessionCookies = ({ sessionData, sessionToken }: SessionCookieSet): SessionCookies => {
  const companion = toCompanionCookie(sessionToken);
  const companionSet = serializeCookie(companion, "1");
  const companionClear = serializeExpiredCookie(companion);
  const sessionTokenPrefix = `${sessionToken.name}=`;

  const readSessionTokenCookies = (response: Response): string[] =>
    response.headers.getSetCookie().filter((cookie) => cookie.startsWith(sessionTokenPrefix));

  const hasSessionTokenSet = (response: Response): boolean =>
    readSessionTokenCookies(response).some((cookie) => !cookie.includes(EXPIRED_ATTRIBUTE));

  const hasSessionTokenCleared = (response: Response): boolean =>
    readSessionTokenCookies(response).some((cookie) => cookie.includes(EXPIRED_ATTRIBUTE));

  const hasCompanion = (request: Request): boolean =>
    readRequestCookieNames(request).includes(companion.name);

  const finalizeAuthResponse = async (
    pathname: string,
    request: Request,
    response: Response,
  ): Promise<Response> => {
    if (hasSessionTokenSet(response)) {
      return withCookies(response, [companionSet]);
    }

    if (hasSessionTokenCleared(response)) {
      return withCookies(response, [companionClear]);
    }

    if (pathname !== SESSION_PATHNAME) {
      return response;
    }

    const body = await response.clone().json();

    if (!isNullSession(body)) {
      const expiry = readSessionExpiry(body);
      if (!expiry || hasCompanion(request)) {
        return response;
      }
      return withCookies(response, [serializeCookieUntil(companion, "1", expiry)]);
    }

    return withCookies(response, [
      serializeExpiredCookie(sessionToken),
      serializeExpiredCookie(sessionData),
      companionClear,
    ]);
  };

  const hasSessionToken = (request: Request): boolean =>
    request.headers.get("cookie")?.includes(sessionTokenPrefix) ?? false;

  return { finalizeAuthResponse, hasSessionToken };
};

export { COMPANION_COOKIE_NAME, createSessionCookies, isNullSession };
export type { SessionCookieSet, SessionCookies };
