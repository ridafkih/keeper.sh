import type { AccountId } from "@keeper.sh/sync-protocol";
import { normalizeResourcePath } from "./resource-path";

const withoutTrailingSlash = (pathname: string): string => {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
};

const hostOf = (serverUrl: string): string => {
  const parsed = URL.parse(serverUrl);
  if (!parsed) {
    return serverUrl;
  }
  return parsed.host;
};

const caldavAccountId = (serverUrl: string, principalHref: string): AccountId => ({
  kind: "accountId",
  value: `${hostOf(serverUrl)}${withoutTrailingSlash(normalizeResourcePath(principalHref, serverUrl))}`,
});

export { caldavAccountId };
