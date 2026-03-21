import type { OAuthConfig, OAuthProviderName } from "./provider-resolution-policy";

interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

const resolveOAuthClientConfig = (
  provider: OAuthProviderName,
  oauthConfig: OAuthConfig,
): OAuthClientConfig | null => {
  switch (provider) {
    case "google": {
      if (!oauthConfig.googleClientId || !oauthConfig.googleClientSecret) {
        return null;
      }
      return {
        clientId: oauthConfig.googleClientId,
        clientSecret: oauthConfig.googleClientSecret,
      };
    }
    case "outlook": {
      if (!oauthConfig.microsoftClientId || !oauthConfig.microsoftClientSecret) {
        return null;
      }
      return {
        clientId: oauthConfig.microsoftClientId,
        clientSecret: oauthConfig.microsoftClientSecret,
      };
    }
    default: {
      return null;
    }
  }
};

export { resolveOAuthClientConfig };
export type { OAuthClientConfig };
