interface OAuthRefreshResult {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface OAuthTokenProvider {
  refreshAccessToken: (refreshToken: string) => Promise<OAuthRefreshResult>;
}

export type { OAuthRefreshResult, OAuthTokenProvider };
