import type {
  AuthorizationUrlOptions,
  OAuthTokens,
  NormalizedUserInfo as OAuthUserInfo,
  ValidatedState,
} from "@keeper.sh/calendar";
import { oauthProviders } from "@/context";

const isOAuthProvider = (provider: string): boolean => oauthProviders.isOAuthProvider(provider);

const getOAuthProviderOrThrow = (provider: string) => {
  const oauthProvider = oauthProviders.getProvider(provider);
  if (!oauthProvider) {
    throw new Error(`OAuth provider not found: ${provider}`);
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
  isOAuthProvider,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  fetchUserInfo,
  validateState,
};
