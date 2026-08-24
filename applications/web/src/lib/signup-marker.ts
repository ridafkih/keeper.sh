const SIGNUP_MARKER = "keeper_signup";

const withSignupMarker = (target: string, origin: string): string => {
  const url = new URL(target, origin);
  if (url.origin !== origin) return target;

  url.searchParams.set(SIGNUP_MARKER, "1");
  return `${url.pathname}${url.search}${url.hash}`;
};

const stripSignupMarker = (href: string): string | null => {
  const url = new URL(href);
  if (!url.searchParams.has(SIGNUP_MARKER)) return null;

  url.searchParams.delete(SIGNUP_MARKER);
  return `${url.pathname}${url.search}${url.hash}`;
};

export { SIGNUP_MARKER, stripSignupMarker, withSignupMarker };
