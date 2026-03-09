const SESSION_COOKIE = "keeper.has_session=1";

export function hasSessionCookie(cookieHeader?: string): boolean {
  const cookieSource = cookieHeader
    ?? (typeof document === "undefined" ? "" : document.cookie);

  return cookieSource
    .split(";")
    .map((cookie) => cookie.trim())
    .some((cookie) => cookie.startsWith(SESSION_COOKIE));
}
