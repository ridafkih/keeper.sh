import { authCapabilitiesSchema } from "@keeper.sh/data-schemas";
import type { AuthCapabilities } from "@keeper.sh/data-schemas";

interface ResolveAuthCapabilitiesConfig {
  commercialMode?: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  oidcIssuerUrl?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcProviderName?: string;
  disableLocalAuth?: boolean;
  passkeyRpId?: string;
  passkeyOrigin?: string;
}

const hasOAuthCredentials = (clientId?: string, clientSecret?: string): boolean =>
  Boolean(clientId && clientSecret);

const resolveCredentialMode = (
  commercialMode?: boolean,
): AuthCapabilities["credentialMode"] => {
  if (commercialMode) {
    return "email";
  }

  return "username";
};

const hasOidcCredentials = (config: ResolveAuthCapabilitiesConfig): boolean =>
  Boolean(config.oidcIssuerUrl && config.oidcClientId && config.oidcClientSecret);

const resolveOidcCapabilities = (
  config: ResolveAuthCapabilitiesConfig,
): Pick<AuthCapabilities, "disableLocalAuth" | "oidcProviderName"> => {
  if (!hasOidcCredentials(config)) {
    return {};
  }

  return {
    ...(config.disableLocalAuth && { disableLocalAuth: true }),
    ...(config.oidcProviderName && { oidcProviderName: config.oidcProviderName }),
  };
};

const resolveAuthCapabilities = (
  config: ResolveAuthCapabilitiesConfig,
): AuthCapabilities =>
  authCapabilitiesSchema.assert({
    commercialMode: config.commercialMode ?? false,
    credentialMode: resolveCredentialMode(config.commercialMode),
    requiresEmailVerification: config.commercialMode ?? false,
    socialProviders: {
      google: hasOAuthCredentials(config.googleClientId, config.googleClientSecret),
      microsoft: hasOAuthCredentials(config.microsoftClientId, config.microsoftClientSecret),
      ...(hasOidcCredentials(config) && { oidc: true }),
    },
    supportsChangePassword: true,
    supportsPasskeys: Boolean(
      config.commercialMode && config.passkeyOrigin && config.passkeyRpId,
    ),
    supportsPasswordReset: config.commercialMode ?? false,
    ...resolveOidcCapabilities(config),
  });

export { resolveAuthCapabilities };
export type { ResolveAuthCapabilitiesConfig };
