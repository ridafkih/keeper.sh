const DISCARDED_SIGN_IN_TOKENS = {
  accessToken: null,
  accessTokenExpiresAt: null,
  idToken: null,
  refreshToken: null,
  refreshTokenExpiresAt: null,
} as const;

const discardSignInTokens = (): Promise<{ data: typeof DISCARDED_SIGN_IN_TOKENS }> =>
  Promise.resolve({ data: DISCARDED_SIGN_IN_TOKENS });

export { DISCARDED_SIGN_IN_TOKENS, discardSignInTokens };
