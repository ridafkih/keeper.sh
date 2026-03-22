import type {
  AuthorizationUrlOptions,
  OAuthTokens,
  NormalizedUserInfo as OAuthUserInfo,
  ValidatedState,
} from "@keeper.sh/calendar";
import { oauthProviders } from "@/context";
import { OAuthProviderNotFoundError } from "./destination-errors";

const isOAuthProvider = (provider: string): boolean => oauthProviders.isOAuthProvider(provider);

const hasRequiredScopes = (provider: string, grantedScopes: string): boolean =>
  oauthProviders.hasRequiredScopes(provider, grantedScopes);

const getOAuthProviderOrThrow = (provider: string) => {
  const oauthProvider = oauthProviders.getProvider(provider);
  if (!oauthProvider) {
    throw new OAuthProviderNotFoundError(provider);
  }
  return oauthProvider;
};

const getAuthorizationUrl = (
  provider: string,
  userId: string,
  options: AuthorizationUrlOptions,
): Promise<string> => getOAuthProviderOrThrow(provider).getAuthorizationUrl(userId, options);

const exchangeCodeForTokens = (
  provider: string,
  code: string,
  callbackUrl: string,
): Promise<OAuthTokens> => getOAuthProviderOrThrow(provider).exchangeCodeForTokens(code, callbackUrl);

const fetchUserInfo = (provider: string, accessToken: string): Promise<OAuthUserInfo> =>
  getOAuthProviderOrThrow(provider).fetchUserInfo(accessToken);

const validateState = (state: string): Promise<ValidatedState | null> => oauthProviders.validateState(state);

export {
  exchangeCodeForTokens,
  fetchUserInfo,
  getAuthorizationUrl,
  hasRequiredScopes,
  isOAuthProvider,
  validateState,
};
