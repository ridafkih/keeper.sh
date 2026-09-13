import { widelog } from "@/utils/logging";
import { OAuthSourceLimitError } from "@/utils/oauth-sources";

const GOOGLE_LOGIN_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];
const MICROSOFT_CALENDAR_SCOPE = "calendars.readwrite";
const MICROSOFT_GRAPH_RESOURCE_PREFIX = "https://graph.microsoft.com/";
const LOGIN_PROVIDERS: Record<string, string> = { google: "google", microsoft: "outlook" };
const LOGIN_PROVIDER_IDS = Object.keys(LOGIN_PROVIDERS);
const EXPIRY_SKEW_MS = 60_000;

interface LoginAccount {
  providerId: string;
  accountId: string;
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshToken: string | null;
  scope: string | null;
}

interface AccessToken {
  accessToken: string;
  expiresAt: Date;
}

interface ImportLoginRouteContext {
  userId: string;
}

interface ImportLoginRouteDependencies {
  loadLoginAccounts: (userId: string) => Promise<LoginAccount[]>;
  refreshToken: (provider: string, refreshToken: string) => Promise<AccessToken>;
  fetchUserInfo: (provider: string, accessToken: string) => Promise<{ id: string; email: string }>;
  createCredential: (
    userId: string,
    data: { provider: string; email: string | null; accessToken: string; refreshToken: string; expiresAt: Date },
  ) => Promise<string>;
  importCalendars: (options: {
    userId: string;
    provider: string;
    oauthCredentialId: string;
    accessToken: string;
    email: string | null;
    providerAccountId: string | null;
  }) => Promise<string>;
  now: () => number;
}

const splitScopes = (scope: string): string[] => scope.split(/[\s,]+/u).filter(Boolean);

const normalizeMicrosoftScope = (scope: string): string => {
  const lowered = scope.toLowerCase();
  if (lowered.startsWith(MICROSOFT_GRAPH_RESOURCE_PREFIX)) {
    return lowered.slice(MICROSOFT_GRAPH_RESOURCE_PREFIX.length);
  }
  return lowered;
};

const hasLoginCalendarScopes = (provider: string, scope: string | null): boolean => {
  if (!scope) {
    return false;
  }
  const scopes = splitScopes(scope);
  if (provider === "google") {
    return GOOGLE_LOGIN_SCOPES.every((required) => scopes.includes(required));
  }
  if (provider === "outlook") {
    return scopes.map((granted) => normalizeMicrosoftScope(granted)).includes(MICROSOFT_CALENDAR_SCOPE);
  }
  return false;
};

const resolveAccessToken = (
  provider: string,
  account: LoginAccount,
  refreshToken: string,
  dependencies: ImportLoginRouteDependencies,
): Promise<AccessToken> => {
  const { accessToken, accessTokenExpiresAt } = account;
  if (accessToken && accessTokenExpiresAt && accessTokenExpiresAt.getTime() - EXPIRY_SKEW_MS > dependencies.now()) {
    return Promise.resolve({ accessToken, expiresAt: accessTokenExpiresAt });
  }
  return dependencies.refreshToken(provider, refreshToken);
};

const importLoginAccount = async (
  userId: string,
  account: LoginAccount,
  dependencies: ImportLoginRouteDependencies,
): Promise<string | null> => {
  const provider = LOGIN_PROVIDERS[account.providerId];
  if (!provider || !account.refreshToken || !hasLoginCalendarScopes(provider, account.scope)) {
    return null;
  }

  const token = await resolveAccessToken(provider, account, account.refreshToken, dependencies);
  const userInfo = await dependencies.fetchUserInfo(provider, token.accessToken);
  const credentialId = await dependencies.createCredential(userId, {
    accessToken: token.accessToken,
    email: userInfo.email,
    expiresAt: token.expiresAt,
    provider,
    refreshToken: account.refreshToken,
  });

  return dependencies.importCalendars({
    accessToken: token.accessToken,
    email: userInfo.email,
    oauthCredentialId: credentialId,
    provider,
    providerAccountId: userInfo.id,
    userId,
  });
};

const handleImportLoginRoute = async (
  context: ImportLoginRouteContext,
  dependencies: ImportLoginRouteDependencies,
): Promise<Response> => {
  const accounts = await dependencies.loadLoginAccounts(context.userId);
  const accountIds: string[] = [];

  for (const account of accounts) {
    try {
      const accountId = await importLoginAccount(context.userId, account, dependencies);
      if (accountId) {
        accountIds.push(accountId);
      }
    } catch (error) {
      if (error instanceof OAuthSourceLimitError) {
        widelog.set("login_import.limit_reached", true);
        break;
      }
      widelog.set("login_import.failed_provider", account.providerId);
      widelog.errorFields(error, { slug: "login-import-failed", retriable: true });
    }
  }

  widelog.set("login_import.accounts", accountIds.length);
  return Response.json({ accountIds });
};

export { handleImportLoginRoute, hasLoginCalendarScopes, LOGIN_PROVIDER_IDS };
export type { ImportLoginRouteDependencies, LoginAccount };
