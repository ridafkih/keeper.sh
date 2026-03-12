type SearchParams = Record<string, unknown>;
type StringSearchParams = Record<string, string>;

const MCP_AUTH_REQUIRED_KEYS = [
  "client_id",
  "code_challenge",
  "code_challenge_method",
  "redirect_uri",
  "response_type",
  "scope",
  "state",
] as const;

const DEFAULT_POST_AUTH_PATH = "/dashboard";

const resolvePathWithSearch = (
  pathname: string,
  search?: StringSearchParams,
): string => {
  if (!search || Object.keys(search).length === 0) {
    return pathname;
  }

  return `${pathname}?${new URLSearchParams(search).toString()}`;
};

const toStringSearchParams = (search: SearchParams): StringSearchParams =>
  Object.fromEntries(
    Object.entries(search).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : []),
  );

const getMcpAuthorizationSearch = (
  search: SearchParams,
): StringSearchParams | null => {
  const stringParams = toStringSearchParams(search);

  const hasAllRequiredKeys = MCP_AUTH_REQUIRED_KEYS.every(
    (key) => typeof stringParams[key] === "string" && stringParams[key].length > 0,
  );

  if (!hasAllRequiredKeys) {
    return null;
  }

  return stringParams;
};

const isMcpAuthorizationContinuation = (search: SearchParams): boolean =>
  getMcpAuthorizationSearch(search) !== null;

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

const resolveClientApiOrigin = (): string => {
  const configuredApiOrigin = import.meta.env.VITE_API_URL;

  if (typeof configuredApiOrigin === "string" && configuredApiOrigin.length > 0) {
    return configuredApiOrigin;
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "";
};

const resolveClientPostAuthRedirect = (
  search: SearchParams,
  defaultPath = DEFAULT_POST_AUTH_PATH,
): string => {
  const apiOrigin = resolveClientApiOrigin();

  if (apiOrigin.length === 0) {
    return defaultPath;
  }

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
