const SESSION_COOKIE = "keeper.has_session=1";

export function readCookie(name: string, cookieHeader?: string): string | null {
  const cookieSource = cookieHeader
    ?? (typeof document === "undefined" ? "" : document.cookie);
  const prefix = `${name}=`;
  const cookie = cookieSource
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return cookie ? cookie.slice(prefix.length) : null;
}

export function hasSessionCookie(cookieHeader?: string): boolean {
  return readCookie("keeper.has_session", cookieHeader) === "1";
}

export { SESSION_COOKIE };
