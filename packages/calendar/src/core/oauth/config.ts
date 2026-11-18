import type { MicrosoftDirectoryTenant, MicrosoftOAuthCredentials } from "@keeper.sh/data-schemas";

interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

interface OAuthEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_TENANT_ID?: MicrosoftDirectoryTenant;
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

const buildMicrosoftOAuthCredentials = (env: OAuthEnv): MicrosoftOAuthCredentials | null => {
  const credentials = getCredentials(env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET);
  if (!credentials) {
    return null;
  }

  return { ...credentials, tenant: env.MICROSOFT_TENANT_ID ?? "common" };
};

const buildOAuthConfigs = (env: OAuthEnv): OAuthConfigs => ({
  google: getCredentials(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
  microsoft: buildMicrosoftOAuthCredentials(env),
});

export { buildMicrosoftOAuthCredentials, buildOAuthConfigs };
export type { OAuthCredentials, MicrosoftOAuthCredentials, OAuthEnv, OAuthConfigs };
