import {
  createGoogleOAuthService,
  fetchUserInfo as fetchGoogleUserInfo,
  validateState as validateGoogleState,
  hasRequiredScopes as hasRequiredGoogleScopes,
  type GoogleOAuthCredentials,
} from "@keeper.sh/oauth-google";
import {
  createMicrosoftOAuthService,
  fetchUserInfo as fetchMicrosoftUserInfo,
  validateState as validateMicrosoftState,
  hasRequiredScopes as hasRequiredMicrosoftScopes,
  type MicrosoftOAuthCredentials,
} from "@keeper.sh/oauth-microsoft";

export interface AuthorizationUrlOptions {
  callbackUrl: string;
  scopes?: string[];
}

export interface NormalizedUserInfo {
  id: string;
  email: string;
}

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

export interface OAuthProvider {
  getAuthorizationUrl: (userId: string, options: AuthorizationUrlOptions) => string;
  exchangeCodeForTokens: (code: string, callbackUrl: string) => Promise<OAuthTokens>;
  fetchUserInfo: (accessToken: string) => Promise<NormalizedUserInfo>;
  refreshAccessToken: (refreshToken: string) => Promise<OAuthTokens>;
  hasRequiredScopes: (grantedScopes: string) => boolean;
}

export interface OAuthProvidersConfig {
  google?: GoogleOAuthCredentials;
  microsoft?: MicrosoftOAuthCredentials;
}

export interface OAuthProviders {
  getProvider: (providerId: string) => OAuthProvider | undefined;
  isOAuthProvider: (providerId: string) => boolean;
  validateState: (state: string) => string | null;
  hasRequiredScopes: (providerId: string, grantedScopes: string) => boolean;
}

export const createOAuthProviders = (config: OAuthProvidersConfig): OAuthProviders => {
  const providers: Record<string, OAuthProvider> = {};

  if (config.google) {
    const googleService = createGoogleOAuthService(config.google);
    providers.google = {
      getAuthorizationUrl: googleService.getAuthorizationUrl,
      exchangeCodeForTokens: googleService.exchangeCodeForTokens,
      refreshAccessToken: googleService.refreshAccessToken,
      fetchUserInfo: async (accessToken) => {
        const info = await fetchGoogleUserInfo(accessToken);
        return { id: info.id, email: info.email };
      },
      hasRequiredScopes: hasRequiredGoogleScopes,
    };
  }

  if (config.microsoft) {
    const microsoftService = createMicrosoftOAuthService(config.microsoft);
    providers.outlook = {
      getAuthorizationUrl: microsoftService.getAuthorizationUrl,
      exchangeCodeForTokens: microsoftService.exchangeCodeForTokens,
      refreshAccessToken: microsoftService.refreshAccessToken,
      fetchUserInfo: async (accessToken) => {
        const info = await fetchMicrosoftUserInfo(accessToken);
        return { id: info.id, email: info.mail ?? info.userPrincipalName ?? "" };
      },
      hasRequiredScopes: hasRequiredMicrosoftScopes,
    };
  }

  const getProvider = (providerId: string): OAuthProvider | undefined => {
    return providers[providerId];
  };

  const isOAuthProvider = (providerId: string): boolean => {
    return providerId in providers;
  };

  const validateState = (state: string): string | null => {
    const googleUserId = validateGoogleState(state);
    if (googleUserId) return googleUserId;

    const microsoftUserId = validateMicrosoftState(state);
    if (microsoftUserId) return microsoftUserId;

    return null;
  };

  const hasRequiredScopes = (providerId: string, grantedScopes: string): boolean => {
    const provider = providers[providerId];
    if (!provider) return false;
    return provider.hasRequiredScopes(grantedScopes);
  };

  return { getProvider, isOAuthProvider, validateState, hasRequiredScopes };
};
