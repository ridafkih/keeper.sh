import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt as jwtPlugin } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { passkey as passkeyPlugin } from "@better-auth/passkey";
import { checkout, polar, portal } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";
import { Resend } from "resend";
import { usernameOnly } from "@keeper.sh/auth-plugin-username-only";
import { deletePolarCustomerByExternalId } from "./polar-customer-delete";
import { writeAuthStderr } from "./runtime-environment";
import { resolveAuthCapabilities } from "./capabilities";
import {
  resolveMcpAuthOptions,
} from "./mcp-config";
import {
  account as accountTable,
  jwks as jwksTable,
  oauthAccessToken as oauthAccessTokenTable,
  oauthClient as oauthClientTable,
  oauthConsent as oauthConsentTable,
  oauthRefreshToken as oauthRefreshTokenTable,
  passkey as passkeyTable,
  session as sessionTable,
  user as userTable,
  verification as verificationTable,
} from "@keeper.sh/database/auth-schema";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { BetterAuthPlugin, User } from "better-auth";

interface EmailUser {
  email: string;
  name: string;
}

interface SendEmailParams {
  user: EmailUser;
  url: string;
}

interface AuthConfig {
  database: BunSQLDatabase;
  secret: string;
  baseUrl: string;
  webBaseUrl?: string;
  commercialMode?: boolean;
  polarAccessToken?: string;
  polarMode?: "sandbox" | "production";
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  resendApiKey?: string;
  passkeyRpId?: string;
  passkeyRpName?: string;
  passkeyOrigin?: string;
  trustedOrigins?: string[];
  mcpResourceUrl?: string;
}

interface KeeperMcpAuthSession {
  scopes: string;
  userId: string | null;
}

interface KeeperMcpAuthApi {
  getMcpSession: (input: { headers: Headers }) => Promise<KeeperMcpAuthSession | null>;
  getMCPProtectedResource: () => Promise<unknown>;
  getMcpOAuthConfig: () => Promise<unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const extractSignUpEmail = (value: unknown): string | null => {
  if (!isRecord(value) || typeof value.email !== "string") {
    return null;
  }

  return value.email;
};

const createAuth = (config: AuthConfig) => {
  const {
    database,
    secret,
    baseUrl,
    webBaseUrl,
    commercialMode = false,
    polarAccessToken,
    polarMode,
    googleClientId,
    googleClientSecret,
    microsoftClientId,
    microsoftClientSecret,
    resendApiKey,
    passkeyRpId,
    passkeyRpName,
    passkeyOrigin,
    trustedOrigins,
    mcpResourceUrl,
  } = config;

  const buildResendClient = (): Resend | null => {
    if (resendApiKey) {
      return new Resend(resendApiKey);
    }
    return null;
  };

  const resend = buildResendClient();
  const capabilities = resolveAuthCapabilities({
    commercialMode,
    googleClientId,
    googleClientSecret,
    microsoftClientId,
    microsoftClientSecret,
    passkeyOrigin,
    passkeyRpId,
  });

  const plugins: BetterAuthPlugin[] = [];

  if (!commercialMode) {
    plugins.push(usernameOnly());
  }

  const buildPolarClient = (): Polar | null => {
    if (polarAccessToken && polarMode) {
      return new Polar({
        accessToken: polarAccessToken,
        server: polarMode,
      });
    }
    return null;
  };

  const polarClient = buildPolarClient();

  if (polarClient) {
    const buildCheckoutSuccessUrl = (): string => {
      if (!webBaseUrl) {
        return "/dashboard/billing?success=true";
      }
      return new URL("/dashboard/billing?success=true", webBaseUrl).toString();
    };

    const checkoutSuccessUrl = buildCheckoutSuccessUrl();

    plugins.push(
      polar({
        client: polarClient,
        createCustomerOnSignUp: true,
        use: [
          checkout({
            successUrl: checkoutSuccessUrl,
          }),
          portal(),
        ],
      }),
    );
  }

  if (commercialMode && passkeyRpId && passkeyOrigin) {
    plugins.push(
      passkeyPlugin({
        origin: passkeyOrigin,
        rpID: passkeyRpId,
        rpName: passkeyRpName,
      }),
    );
  }

  const mcpOptions = resolveMcpAuthOptions({
    resourceBaseUrl: mcpResourceUrl,
    webBaseUrl,
  });

  if (mcpOptions) {
    plugins.push(jwtPlugin());
    plugins.push(oauthProvider(mcpOptions.oauthProvider));
  }

  const socialProviders: Parameters<typeof betterAuth>[0]["socialProviders"] = {};

  if (googleClientId && googleClientSecret) {
    socialProviders.google = {
      accessType: "offline",
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/calendar.events"],
    };
  }

  if (microsoftClientId && microsoftClientSecret) {
    socialProviders.microsoft = {
      clientId: microsoftClientId,
      clientSecret: microsoftClientSecret,
      prompt: "consent",
      scope: ["offline_access", "User.Read", "Calendars.ReadWrite"],
    };
  }

  const auth = betterAuth({
    account: {
      accountLinking: {
        allowDifferentEmails: true,
      },
    },
    basePath: "/api/auth",
    baseURL: baseUrl,
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: {
        account: accountTable,
        jwks: jwksTable,
        oauthAccessToken: oauthAccessTokenTable,
        oauthClient: oauthClientTable,
        oauthConsent: oauthConsentTable,
        oauthRefreshToken: oauthRefreshTokenTable,
        passkey: passkeyTable,
        session: sessionTable,
        user: userTable,
        verification: verificationTable,
      },
    }),
    emailAndPassword: {
      enabled: commercialMode,
      requireEmailVerification: commercialMode,
      sendResetPassword: async ({ user, url }: SendEmailParams) => {
        if (!resend) {
          return;
        }
        await resend.emails.send({
          template: {
            id: "password-reset",
            variables: { name: user.name, url },
          },
          to: user.email,
        });
      },
    },
    emailVerification: {
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }: SendEmailParams) => {
        if (!resend) {
          return;
        }
        await resend.emails.send({
          template: {
            id: "email-verification",
            variables: { name: user.name, url },
          },
          to: user.email,
        });
      },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path !== "/sign-up/email") {
          return;
        }
        const email = extractSignUpEmail(context.body);
        if (!email) {
          return;
        }
        const existingUser = await context.context.adapter.findOne<User>({
          model: "user",
          where: [
            { field: "email", value: email },
            { field: "emailVerified", value: false },
          ],
        });
        if (!existingUser) {
          return;
        }
        await context.context.internalAdapter.deleteUser(existingUser.id);
      }),
    },
    onAPIError: {
      onError(error: unknown) {
        if (typeof error !== "object" || error === null) {
          return;
        }
        if (!("body" in error) || typeof error.body !== "object" || error.body === null) {
          return;
        }
        if (!("message" in error.body) || typeof error.body.message !== "string") {
          return;
        }

        if (error.body.message.toLowerCase().includes("invalid origin")) {
          writeAuthStderr(
            "A request has failed due to an origin mismatch. If this was meant to be a valid request, please set the `TRUSTED_ORIGINS` environment variable to include the origin you intend on accessing Keeper from.\n\nThis should be a comma-delimited array of values, for more information please refer to the documentation on GitHub. https://github.com/ridafkih/keeper.sh#accessing-keeper-from-non-localhost-urls",
          );
        }
      },
    },
    plugins,
    secret,
    socialProviders,
    trustedOrigins,
    user: {
      deleteUser: {
        afterDelete: async (user) => {
          if (!polarClient) {
            return;
          }

          await deletePolarCustomerByExternalId(polarClient, user.id);
        },
        enabled: true,
      },
    },
  });

  if (mcpOptions) {
    const resourceActions = oauthProviderResourceClient(auth as any).getActions() as any;
    const authApi = auth.api as any;

    Object.assign(authApi, {
      getMCPProtectedResource: async () =>
        resourceActions.getProtectedResourceMetadata(
          mcpOptions.protectedResourceMetadata,
        ),
      getMcpOAuthConfig: async () =>
        authApi.getOAuthServerConfig({
          headers: new Headers(),
        }),
      getMcpSession: async ({ headers }: { headers: Headers }) => {
        const authorization = headers.get("authorization");

        if (!authorization?.startsWith("Bearer ")) {
          return null;
        }

        const accessToken = authorization.slice("Bearer ".length).trim();

        if (accessToken.length === 0) {
          return null;
        }

        const jwt = await resourceActions.verifyAccessToken(accessToken, {
            verifyOptions: {
              audience: mcpOptions.oauthProvider.validAudiences,
              issuer: `${baseUrl}/api/auth`,
            },
          });

          return {
            scopes: typeof jwt.scope === "string" ? jwt.scope : "",
            userId: typeof jwt.sub === "string" ? jwt.sub : null,
          };
      },
    } satisfies KeeperMcpAuthApi);
  }

  return { auth, capabilities, polarClient: polarClient ?? null };
};

type KeeperMcpEnabledAuth<TAuth = ReturnType<typeof betterAuth>> = TAuth & {
  api: KeeperMcpAuthApi;
};

const asKeeperMcpEnabledAuth = <TAuth>(auth: TAuth): KeeperMcpEnabledAuth<TAuth> =>
  auth as KeeperMcpEnabledAuth<TAuth>;

export { createAuth };
export { asKeeperMcpEnabledAuth };
export { resolveAuthCapabilities } from "./capabilities";
export {
  KEEPER_API_DEFAULT_SCOPE,
  KEEPER_API_DESTINATION_SCOPE,
  KEEPER_API_EVENT_SCOPE,
  KEEPER_API_MAPPING_SCOPE,
  KEEPER_API_READ_SCOPE,
  KEEPER_API_RESOURCE_SCOPES,
  KEEPER_API_SCOPES,
  KEEPER_API_SOURCE_SCOPE,
  KEEPER_API_SYNC_SCOPE,
} from "./mcp-config";
type AuthResult = ReturnType<typeof createAuth>;
export type {
  AuthConfig,
  AuthResult,
  KeeperMcpAuthApi,
  KeeperMcpAuthSession,
  KeeperMcpEnabledAuth,
};
