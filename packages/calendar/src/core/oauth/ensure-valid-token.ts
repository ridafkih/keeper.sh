import { TOKEN_REFRESH_BUFFER_MS } from "@keeper.sh/constants";

const MS_PER_SECOND = 1000;

interface TokenState {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
}

interface OAuthTokenRefreshResult {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

type TokenRefresher = (refreshToken: string) => Promise<OAuthTokenRefreshResult>;

const ensureValidToken = async (
  tokenState: TokenState,
  refreshAccessToken: TokenRefresher,
): Promise<void> => {
  if (tokenState.accessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return;
  }

  const result = await refreshAccessToken(tokenState.refreshToken);
  tokenState.accessToken = result.access_token;
  tokenState.accessTokenExpiresAt = new Date(Date.now() + result.expires_in * MS_PER_SECOND);

  if (result.refresh_token) {
    tokenState.refreshToken = result.refresh_token;
  }
};

export { ensureValidToken };
export type { TokenState, TokenRefresher, OAuthTokenRefreshResult };
