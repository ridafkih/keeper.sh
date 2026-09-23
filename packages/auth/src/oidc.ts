import { genericOAuth } from "better-auth/plugins";
import type { BetterAuthPlugin } from "better-auth";

const OIDC_PROVIDER_ID = "oidc";
const DEFAULT_OIDC_SCOPES = ["openid", "profile", "email"];
const LOCAL_ACCOUNT_EMAIL_SUFFIX = "@local";

const LOCAL_AUTH_PATHS = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/username-only/sign-in",
  "/username-only/sign-up",
  "/request-password-reset",
  "/reset-password",
]);

interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[] | null;
}

interface OidcProfile {
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  preferred_username?: unknown;
}

const readNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
};

const resolveOidcDiscoveryUrl = (issuerUrl: string): string =>
  `${issuerUrl.replace(/\/+$/, "")}/.well-known/openid-configuration`;

const resolveOidcDisplayName = (profile: OidcProfile): string | null => {
  const name = readNonEmptyString(profile.name);
  if (name) {
    return name;
  }
  const preferredUsername = readNonEmptyString(profile.preferred_username);
  if (preferredUsername) {
    return preferredUsername;
  }
  const email = readNonEmptyString(profile.email);
  if (!email) {
    return null;
  }
  const [localPart] = email.split("@");
  return readNonEmptyString(localPart);
};

const mapOidcProfileToUser = (profile: OidcProfile) => {
  const name = resolveOidcDisplayName(profile);
  if (!name) {
    return { emailVerified: false };
  }
  return { emailVerified: false, name };
};

const isLocalAccountEmail = (email: string): boolean =>
  email.toLowerCase().endsWith(LOCAL_ACCOUNT_EMAIL_SUFFIX);

const isLocalAuthPath = (path: string): boolean => LOCAL_AUTH_PATHS.has(path);

const createOidcPlugin = (config: OidcConfig): BetterAuthPlugin =>
  genericOAuth({
    config: [
      {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        discoveryUrl: resolveOidcDiscoveryUrl(config.issuerUrl),
        mapProfileToUser: mapOidcProfileToUser,
        pkce: true,
        providerId: OIDC_PROVIDER_ID,
        scopes: config.scopes ?? DEFAULT_OIDC_SCOPES,
      },
    ],
  });

export {
  OIDC_PROVIDER_ID,
  createOidcPlugin,
  isLocalAccountEmail,
  isLocalAuthPath,
  mapOidcProfileToUser,
  resolveOidcDiscoveryUrl,
};
export type { OidcConfig };
