interface ProviderUserInfo {
  id?: string | null;
}

interface ProviderAccountIdentityRequest {
  fetchUserInfo: (accessToken: string) => Promise<ProviderUserInfo>;
  resolveAccessToken: () => Promise<string>;
  subject: string;
}

const resolveProviderAccountIdentity = async (
  request: ProviderAccountIdentityRequest,
): Promise<string> => {
  const accessToken = await request.resolveAccessToken();
  const userInfo = await request.fetchUserInfo(accessToken);

  if (!userInfo.id) {
    throw new Error(`The provider returned no account id for ${request.subject}`);
  }

  return userInfo.id;
};

export { resolveProviderAccountIdentity };
export type { ProviderAccountIdentityRequest, ProviderUserInfo };
