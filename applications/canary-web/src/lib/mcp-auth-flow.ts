type SearchParams = Record<string, unknown>;
type StringSearchParams = Record<string, string>;

const DEFAULT_POST_AUTH_PATH = "/dashboard";

const MCP_AUTH_REQUIRED_KEYS = [
  "client_id",
  "code_challenge",
  "code_challenge_method",
  "redirect_uri",
  "response_type",
  "scope",
  "state",
] as const;

const resolvePathWithSearch = (
  pathname: string,
  search?: StringSearchParams,
): string => {
  if (!search || Object.keys(search).length === 0) {
    return pathname;
  }

  const url = new URL(pathname, "http://placeholder");
  url.search = new URLSearchParams(search).toString();
  return `${url.pathname}${url.search}`;
};

const toStringSearchParams = (search: SearchParams): StringSearchParams =>
  Object.fromEntries(
    Object.entries(search).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const getMcpAuthorizationSearch = (
  search: SearchParams,
): StringSearchParams | null => {
  const stringParams = toStringSearchParams(search);

  const hasAllRequiredKeys = MCP_AUTH_REQUIRED_KEYS.every(
    (key) => isNonEmptyString(stringParams[key]),
  );

  if (!hasAllRequiredKeys) {
    return null;
  }

  return stringParams;
};

const isMcpAuthorizationContinuation = (search: SearchParams): boolean =>
  getMcpAuthorizationSearch(search) !== null;

const resolveClientApiOrigin = (): string => {
  const configuredApiOrigin = import.meta.env.VITE_API_URL;

  if (typeof configuredApiOrigin === "string" && configuredApiOrigin.length > 0) {
    return configuredApiOrigin;
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  throw new Error(
    "Unable to resolve API origin: VITE_API_URL is not configured and window is undefined",
  );
};

const resolvePostAuthRedirect = ({
  apiOrigin,
  defaultPath = DEFAULT_POST_AUTH_PATH,
  search,
}: {
  apiOrigin: string;
  defaultPath?: string;
  search: SearchParams;
}): string => {
  const mcpAuthorizationSearch = getMcpAuthorizationSearch(search);

  if (!mcpAuthorizationSearch) {
    return defaultPath;
  }

  const authorizeUrl = new URL("/api/auth/oauth2/authorize", apiOrigin);
  authorizeUrl.search = new URLSearchParams(mcpAuthorizationSearch).toString();

  return authorizeUrl.toString();
};

const resolveClientPostAuthRedirect = (
  search?: SearchParams | null,
  defaultPath = DEFAULT_POST_AUTH_PATH,
): string => {
  if (!search) {
    return defaultPath;
  }

  const apiOrigin = resolveClientApiOrigin();

  return resolvePostAuthRedirect({
    apiOrigin,
    defaultPath,
    search,
  });
};

export {
  getMcpAuthorizationSearch,
  isMcpAuthorizationContinuation,
  resolvePathWithSearch,
  resolveClientPostAuthRedirect,
  resolvePostAuthRedirect,
  toStringSearchParams,
};
export type { SearchParams, StringSearchParams };
