import { type } from "arktype";

type SearchParams = Record<string, unknown>;
type StringSearchParams = Record<string, string>;

const DEFAULT_POST_AUTH_PATH = "/dashboard";

const mcpAuthorizationSearchSchema = type({
  client_id: "string > 0",
  code_challenge: "string > 0",
  code_challenge_method: "string > 0",
  redirect_uri: "string > 0",
  response_type: "string > 0",
  scope: "string > 0",
  state: "string > 0",
  "+": "delete",
});

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

// SearchParams values may be non-string (e.g. from route search parsing),
// so we filter to only string entries before forwarding as query params.
const toStringSearchParams = (search: SearchParams): StringSearchParams =>
  Object.fromEntries(
    Object.entries(search).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

const getMcpAuthorizationSearch = (
  search: SearchParams,
): StringSearchParams | null => {
  const stringParams = toStringSearchParams(search);
  const result = mcpAuthorizationSearchSchema(stringParams);

  if (result instanceof type.errors) {
    return null;
  }

  // Return the full string params (including optional OAuth keys like
  // prompt, resource) rather than just the validated required subset.
  return stringParams;
};

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
  resolvePathWithSearch,
  resolveClientPostAuthRedirect,
  resolvePostAuthRedirect,
  toStringSearchParams,
};
export type { SearchParams, StringSearchParams };
