import {
  createGoogleOAuthService,
  fetchUserInfo as fetchGoogleUserInfo,
  hasRequiredScopes as hasRequiredGoogleScopes,
} from "./google";
import type { GoogleOAuthCredentials, ValidatedState, OAuthStateStore } from "./google";
import {
  createMicrosoftOAuthService,
  fetchUserInfo as fetchMicrosoftUserInfo,
  hasRequiredScopes as hasRequiredMicrosoftScopes,
} from "./microsoft";
import type { MicrosoftOAuthCredentials } from "./microsoft";
import { validateState } from "./state";

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

interface ProviderRequestOptions {
  signal?: AbortSignal;
}

interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

interface OAuthProvider {
  getAuthorizationUrl: (userId: string, options: AuthorizationUrlOptions) => Promise<string>;
  exchangeCodeForTokens: (code: string, callbackUrl: string) => Promise<OAuthTokens>;
  fetchUserInfo: (
    accessToken: string,
    options?: ProviderRequestOptions,
  ) => Promise<NormalizedUserInfo>;
  refreshAccessToken: (
    refreshToken: string,
    options?: ProviderRequestOptions,
  ) => Promise<OAuthTokens>;
  hasRequiredScopes: (grantedScopes: string) => boolean;
}

interface OAuthProvidersConfig {
  google: GoogleOAuthCredentials | null;
  microsoft: MicrosoftOAuthCredentials | null;
}

interface OAuthProviders {
  getProvider: (providerId: string) => OAuthProvider | undefined;
  isOAuthProvider: (providerId: string) => boolean;
  validateState: (state: string) => Promise<ValidatedState | null>;
  hasRequiredScopes: (providerId: string, grantedScopes: string) => boolean;
}

const createOAuthProviders = (
  config: OAuthProvidersConfig,
  stateStore: OAuthStateStore,
): OAuthProviders => {
  const providers: Record<string, OAuthProvider> = {};

  if (config.google) {
    const googleService = createGoogleOAuthService(config.google, stateStore);
    providers.google = {
      exchangeCodeForTokens: googleService.exchangeCodeForTokens,
      fetchUserInfo: async (accessToken, options): Promise<NormalizedUserInfo> => {
        const info = await fetchGoogleUserInfo(accessToken, options?.signal);

        if (!info.email) {
          throw new Error(
            "Google returned no email address for the connected account, so the calendar account cannot be identified",
          );
        }

        return { email: info.email, id: info.id };
      },
      getAuthorizationUrl: googleService.getAuthorizationUrl,
      hasRequiredScopes: hasRequiredGoogleScopes,
      refreshAccessToken: (refreshToken, options) =>
        googleService.refreshAccessToken(refreshToken, options?.signal),
    };
  }

  if (config.microsoft) {
    const microsoftService = createMicrosoftOAuthService(config.microsoft, stateStore);
    providers.outlook = {
      exchangeCodeForTokens: microsoftService.exchangeCodeForTokens,
      fetchUserInfo: async (accessToken, options): Promise<NormalizedUserInfo> => {
        const info = await fetchMicrosoftUserInfo(accessToken, options?.signal);
        return { email: info.mail ?? info.userPrincipalName ?? "", id: info.id };
      },
      getAuthorizationUrl: microsoftService.getAuthorizationUrl,
      hasRequiredScopes: hasRequiredMicrosoftScopes,
      refreshAccessToken: (refreshToken, options) =>
        microsoftService.refreshAccessToken(refreshToken, options?.signal),
    };
  }

  const getProvider = (providerId: string): OAuthProvider | undefined => providers[providerId];

  const isOAuthProvider = (providerId: string): boolean => providerId in providers;

  const handleValidateState = (state: string): Promise<ValidatedState | null> =>
    validateState(stateStore, state);

  const hasRequiredScopes = (providerId: string, grantedScopes: string): boolean => {
    const provider = providers[providerId];
    if (!provider) {
      return false;
    }
    return provider.hasRequiredScopes(grantedScopes);
  };

  return { getProvider, hasRequiredScopes, isOAuthProvider, validateState: handleValidateState };
};

export { createOAuthProviders };
export type {
  ValidatedState,
  AuthorizationUrlOptions,
  NormalizedUserInfo,
  OAuthTokens,
  OAuthProvider,
  OAuthProvidersConfig,
  ProviderRequestOptions,
  OAuthProviders,
  OAuthStateStore,
};
