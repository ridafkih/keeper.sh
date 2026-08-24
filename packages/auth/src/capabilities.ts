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

const resolveAuthCapabilities = (
  config: ResolveAuthCapabilitiesConfig,
): AuthCapabilities => {
  const oidcEnabled = Boolean(
    config.oidcIssuerUrl && config.oidcClientId && config.oidcClientSecret,
  );

  const capabilities: Record<string, unknown> = {
    commercialMode: config.commercialMode ?? false,
    credentialMode: resolveCredentialMode(config.commercialMode),
    disableLocalAuth: Boolean(config.disableLocalAuth && oidcEnabled),
    requiresEmailVerification: config.commercialMode ?? false,
    socialProviders: {
      google: hasOAuthCredentials(config.googleClientId, config.googleClientSecret),
      microsoft: hasOAuthCredentials(config.microsoftClientId, config.microsoftClientSecret),
      oidc: oidcEnabled,
    },
    supportsChangePassword: true,
    supportsPasskeys: Boolean(
      config.commercialMode && config.passkeyOrigin && config.passkeyRpId,
    ),
    supportsPasswordReset: config.commercialMode ?? false,
  };

  if (oidcEnabled && config.oidcProviderName) {
    capabilities.oidcProviderName = config.oidcProviderName;
  }

  return authCapabilitiesSchema.assert(capabilities);
};

export { resolveAuthCapabilities };
export type { ResolveAuthCapabilitiesConfig };
