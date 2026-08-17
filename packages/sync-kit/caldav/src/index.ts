export { caldavCapabilities } from "./capabilities";
export { caldavLimits } from "./limits";
export type { CalDAVLimits } from "./limits";

export { caldavAuthMethods } from "./dependencies";
export type {
  CalDAVAuthMethod,
  CalDAVClock,
  CalDAVCredentials,
  CalDAVDependencies,
} from "./dependencies";

export { createCalDAVProvider } from "./provider";
export { createCalDAVContract } from "./contract";

export { createCalDAVClient } from "./client/dav-client";
export { createAuthenticatingFetch } from "./client/authenticating-fetch";
export type { AuthenticatingFetchOptions } from "./client/authenticating-fetch";

export { caldavFingerprintContract } from "./fingerprint";
export { withinCalDAVWindow } from "./window/membership";

export { normalizeResourcePath } from "./identity/resource-path";
export { normalizeCollectionKey } from "./identity/collection-key";
export { caldavAccountId } from "./identity/account";
