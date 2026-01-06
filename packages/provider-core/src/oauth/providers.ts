import {
  createGoogleOAuthService,
  fetchUserInfo as fetchGoogleUserInfo,
  hasRequiredScopes as hasRequiredGoogleScopes,
  validateState as validateGoogleState,
} from "@keeper.sh/oauth-google";
import type { GoogleOAuthCredentials, ValidatedState } from "@keeper.sh/oauth-google";
import {
  createMicrosoftOAuthService,
  fetchUserInfo as fetchMicrosoftUserInfo,
  hasRequiredScopes as hasRequiredMicrosoftScopes,
  validateState as validateMicrosoftState,
} from "@keeper.sh/oauth-microsoft";
import type { MicrosoftOAuthCredentials } from "@keeper.sh/oauth-microsoft";

interface AuthorizationUrlOptions {
  callbackUrl: string;
  scopes?: string[];
  destinationId?: string;
  sourceCredentialId?: string;
}

interface NormalizedUserInfo {
  id: string;
  email: string;
}

interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

interface OAuthProvider {
  getAuthorizationUrl: (userId: string, options: AuthorizationUrlOptions) => string;
  exchangeCodeForTokens: (code: string, callbackUrl: string) => Promise<OAuthTokens>;
  fetchUserInfo: (accessToken: string) => Promise<NormalizedUserInfo>;
  refreshAccessToken: (refreshToken: string) => Promise<OAuthTokens>;
  hasRequiredScopes: (grantedScopes: string) => boolean;
}

interface OAuthProvidersConfig {
  google: GoogleOAuthCredentials | null;
  microsoft: MicrosoftOAuthCredentials | null;
}

interface OAuthProviders {
  getProvider: (providerId: string) => OAuthProvider | undefined;
  isOAuthProvider: (providerId: string) => boolean;
  validateState: (state: string) => ValidatedState | null;
  hasRequiredScopes: (providerId: string, grantedScopes: string) => boolean;
}

const createOAuthProviders = (config: OAuthProvidersConfig): OAuthProviders => {
  const providers: Record<string, OAuthProvider> = {};

  if (config.google) {
    const googleService = createGoogleOAuthService(config.google);
    providers.google = {
      exchangeCodeForTokens: googleService.exchangeCodeForTokens,
      fetchUserInfo: async (accessToken): Promise<NormalizedUserInfo> => {
        const info = await fetchGoogleUserInfo(accessToken);
        return { email: info.email, id: info.id };
      },
      getAuthorizationUrl: googleService.getAuthorizationUrl,
      hasRequiredScopes: hasRequiredGoogleScopes,
      refreshAccessToken: googleService.refreshAccessToken,
    };
  }

  if (config.microsoft) {
    const microsoftService = createMicrosoftOAuthService(config.microsoft);
    providers.outlook = {
      exchangeCodeForTokens: microsoftService.exchangeCodeForTokens,
      fetchUserInfo: async (accessToken): Promise<NormalizedUserInfo> => {
        const info = await fetchMicrosoftUserInfo(accessToken);
        return { email: info.mail ?? info.userPrincipalName ?? "", id: info.id };
      },
      getAuthorizationUrl: microsoftService.getAuthorizationUrl,
      hasRequiredScopes: hasRequiredMicrosoftScopes,
      refreshAccessToken: microsoftService.refreshAccessToken,
    };
  }

  const getProvider = (providerId: string): OAuthProvider | undefined => providers[providerId];

  const isOAuthProvider = (providerId: string): boolean => providerId in providers;

  const validateState = (state: string): ValidatedState | null => {
    const googleResult = validateGoogleState(state);
    if (googleResult) {
      return googleResult;
    }

    const microsoftResult = validateMicrosoftState(state);
    if (microsoftResult) {
      return microsoftResult;
    }

    return null;
  };

  const hasRequiredScopes = (providerId: string, grantedScopes: string): boolean => {
    const provider = providers[providerId];
    if (!provider) {
      return false;
    }
    return provider.hasRequiredScopes(grantedScopes);
  };

  return { getProvider, hasRequiredScopes, isOAuthProvider, validateState };
};

export { createOAuthProviders };
export type {
  ValidatedState,
  AuthorizationUrlOptions,
  NormalizedUserInfo,
  OAuthTokens,
  OAuthProvider,
  OAuthProvidersConfig,
  OAuthProviders,
};
