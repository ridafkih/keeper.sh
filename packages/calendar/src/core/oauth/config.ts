interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

interface MicrosoftOAuthCredentials extends OAuthCredentials {
  tenantId?: string;
}

interface OAuthEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_TENANT_ID?: string;
}

interface OAuthConfigs {
  google: OAuthCredentials | null;
  microsoft: MicrosoftOAuthCredentials | null;
}

const getCredentials = (
  clientId: string | undefined,
  clientSecret: string | undefined,
): OAuthCredentials | null => {
  if (!clientId) {
    return null;
  }

  if (!clientSecret) {
    return null;
  }

  return { clientId, clientSecret };
};

const buildOAuthConfigs = (env: OAuthEnv): OAuthConfigs => {
  const google = getCredentials(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  const microsoftCredentials = getCredentials(env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET);
  const microsoft = microsoftCredentials && {
    ...microsoftCredentials,
    tenantId: env.MICROSOFT_TENANT_ID,
  };

  return { google, microsoft };
};

export { buildOAuthConfigs };
export type { OAuthCredentials, MicrosoftOAuthCredentials, OAuthEnv, OAuthConfigs };
