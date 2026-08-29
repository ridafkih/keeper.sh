import { type } from "arktype";
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
import { widelog } from "widelogger";
import { usernameOnly } from "./plugins/username-only";
import {
  deletePolarCustomerByExternalId,
  POLAR_CUSTOMER_DELETE_TIMEOUT_MS,
} from "./polar-customer-delete";
import {
  createDeleteUserTeardown,
  createSkippedDeleteUserTeardown,
  recordDeleteUserResidue,
  deleteUserTeardownUnavailable,
  SYNC_TEARDOWN_TIMEOUT_MS,
  TEARDOWN_BUDGET_MS,
  TEARDOWN_FAILED_SLUG,
} from "./delete-user-teardown";
import { createDeleteUserCompensationScope } from "./delete-user-compensation";
import { writeAuthStderr } from "./runtime-environment";
import { resolveAuthCapabilities } from "./capabilities";
import {
  resolveMcpAuthOptions,
  resolveMcpJwksUrl,
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
import type { BetterAuthOptions, BetterAuthPlugin, User } from "better-auth";
import type {
  DeleteUserResidueRecorder,
  DeleteUserTeardown,
} from "./delete-user-teardown";
import type { UnresolvedUserRowSurvival } from "./delete-user-compensation";

type DeleteUserOptions = NonNullable<
  NonNullable<BetterAuthOptions["user"]>["deleteUser"]
>;

type BeforeDeleteUser = NonNullable<DeleteUserOptions["beforeDelete"]>;

type AfterDeleteUser = NonNullable<DeleteUserOptions["afterDelete"]>;

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
  mcpApiBaseUrl?: string;
  deleteUserResidueRecorder: DeleteUserResidueRecorder;
  deleteUserTeardown: DeleteUserTeardown;
  deleteUserTeardownRollback: DeleteUserTeardown;
  markDeleteUserTombstoneProvisional?: DeleteUserTeardown;
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

/**
 * Better Auth's oauthProvider plugin adds API methods at runtime.
 * This type predicate verifies the methods exist so we can call them
 * without type assertions.
 */
interface OAuthProviderAuthApi {
  getOAuthServerConfig: (input: { headers: Headers }) => Promise<unknown>;
  getOpenIdConfig: (input: { headers: Headers }) => Promise<unknown>;
}

const hasOAuthProviderApi = (
  api: object,
): api is OAuthProviderAuthApi => {
  if (!("getOAuthServerConfig" in api)) {
    return false;
  }
  if (!("getOpenIdConfig" in api)) {
    return false;
  }
  if (typeof api.getOAuthServerConfig !== "function") {
    return false;
  }
  if (typeof api.getOpenIdConfig !== "function") {
    return false;
  }
  return true;
};

const POLAR_CUSTOMER_RESIDUE_KIND = "polar_customer";

const mcpJwtClaimsSchema = type({
  scope: "string",
  sub: "string",
  "+": "delete",
});

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
    mcpApiBaseUrl,
    deleteUserResidueRecorder,
    deleteUserTeardown,
    deleteUserTeardownRollback,
    markDeleteUserTombstoneProvisional,
  } = config;

  if (typeof deleteUserTeardown !== "function") {
    throw new TypeError(
      "createAuth requires a deleteUserTeardown; without one an account deletion would quiesce nothing",
    );
  }

  if (typeof deleteUserTeardownRollback !== "function") {
    throw new TypeError(
      "createAuth requires a deleteUserTeardownRollback to undo the deleteUserTeardown when the user row survives",
    );
  }

  if (typeof deleteUserResidueRecorder !== "function") {
    throw new TypeError(
      "createAuth requires a deleteUserResidueRecorder; without one a failed teardown step would leave provider state behind with no way back",
    );
  }

  const buildResendClient = (): Resend | null => {
    if (resendApiKey) {
      return new Resend(resendApiKey);
    }
    return null;
  };

  const {
    finishDeleteUserAttempt,
    instrumentUserRowDelete,
    startDeleteUserAttempt,
    withDeleteUserCompensation,
  } = createDeleteUserCompensationScope();

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

  const buildDestroyExternalState = (): DeleteUserTeardown => {
    if (!polarClient) {
      return createSkippedDeleteUserTeardown("no_polar_client");
    }

    return createDeleteUserTeardown(
      [
        {
          name: POLAR_CUSTOMER_RESIDUE_KIND,
          run: (userId) => deletePolarCustomerByExternalId(polarClient, userId),
          timeoutMs: POLAR_CUSTOMER_DELETE_TIMEOUT_MS,
        },
      ],
      TEARDOWN_BUDGET_MS,
      { recordResidue: deleteUserResidueRecorder },
    );
  };

  const quiesce = createDeleteUserTeardown(
    [{ name: "sync", run: deleteUserTeardown, timeoutMs: SYNC_TEARDOWN_TIMEOUT_MS }],
    TEARDOWN_BUDGET_MS,
    { recordResidue: null },
  );

  const destroyExternalState = buildDestroyExternalState();

  const rollbackQuiesce = createDeleteUserTeardown(
    [
      {
        name: "sync_rollback",
        run: deleteUserTeardownRollback,
        timeoutMs: SYNC_TEARDOWN_TIMEOUT_MS,
      },
    ],
    TEARDOWN_BUDGET_MS,
    { recordResidue: null },
  );

  const beforeDelete: BeforeDeleteUser = async (user) => {
    startDeleteUserAttempt(user.id);
    await quiesce(user.id);
  };

  const afterDelete: AfterDeleteUser = async (user) => {
    finishDeleteUserAttempt();
    await destroyExternalState(user.id);
  };

  const markTombstoneProvisional = async (userId: string): Promise<void> => {
    if (!markDeleteUserTombstoneProvisional) {
      widelog.setFields({ "delete_user.tombstone_provisional_marker_unwired": true });
      return;
    }

    try {
      await markDeleteUserTombstoneProvisional(userId);
      widelog.setFields({ "delete_user.tombstone_marked_provisional": true });
    } catch (error) {
      const failure = {
        "delete_user.user_id": userId,
        prefix: "delete_user_teardown.tombstone_provisional",
        retriable: false,
        slug: TEARDOWN_FAILED_SLUG,
      };

      widelog.errorFields(error, failure);
    }
  };

  const compensateDeleteUser = async (
    userId: string,
    survival: UnresolvedUserRowSurvival,
  ): Promise<void> => {
    if (survival === "unresolvable") {
      widelog.setFields({ "delete_user.teardown_rollback_withheld": true });
      await markTombstoneProvisional(userId);

      if (polarClient) {
        await recordDeleteUserResidue(
          deleteUserResidueRecorder,
          POLAR_CUSTOMER_RESIDUE_KIND,
          userId,
        );
      }

      return;
    }

    widelog.setFields({ "delete_user.teardown_compensated": true });
    await markTombstoneProvisional(userId);
    await rollbackQuiesce(userId);
  };

  const finishDeleteUser = async (userId: string): Promise<void> => {
    widelog.setFields({ "delete_user.external_state_destroyed_after_failure": true });
    await destroyExternalState(userId);
  };

  const deletionQuiesceable =
    deleteUserTeardown !== deleteUserTeardownUnavailable &&
    deleteUserTeardownRollback !== deleteUserTeardownUnavailable;

  const buildDeleteUserOptions = (): DeleteUserOptions => {
    if (!deletionQuiesceable) {
      return { enabled: false };
    }

    return { afterDelete, beforeDelete, enabled: true };
  };

  const deleteUser = buildDeleteUserOptions();

  if (polarClient) {
    const buildCheckoutSuccessUrl = (): string => {
      if (!baseUrl) {
        return "/dashboard/billing?success=true";
      }
      return new URL("/dashboard/billing?success=true", baseUrl).toString();
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
    webBaseUrl: baseUrl,
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

  const baseAuth = betterAuth({
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
      deleteUser,
    },
  });

  if (mcpOptions) {
    const resourceClient = oauthProviderResourceClient();
    const resourceActions = resourceClient.getActions();
    const jwksUrl = resolveMcpJwksUrl(baseUrl, mcpApiBaseUrl);

    if (!hasOAuthProviderApi(baseAuth.api)) {
      throw new Error("OAuth provider plugin did not register expected API methods");
    }

    const oauthApi = baseAuth.api;

    Object.assign(baseAuth.api, {
      getMCPProtectedResource: () =>
        resourceActions.getProtectedResourceMetadata(
          mcpOptions.protectedResourceMetadata,
        ),
      getMcpOAuthConfig: () =>
        oauthApi.getOAuthServerConfig({
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
          jwksUrl,
          verifyOptions: {
            audience: mcpOptions.oauthProvider.validAudiences,
            issuer: `${baseUrl}/api/auth`,
          },
        });

        const claims = mcpJwtClaimsSchema(jwt);

        if (claims instanceof type.errors) {
          throw new TypeError(`Invalid JWT claims: ${claims.summary}`);
        }

        return {
          scopes: claims.scope,
          userId: claims.sub,
        };
      },
    } satisfies KeeperMcpAuthApi);
  }

  const auth = {
    ...baseAuth,
    handler: withDeleteUserCompensation(baseAuth.handler, {
      compensate: compensateDeleteUser,
      finish: finishDeleteUser,
      prepare: async () => {
        const { internalAdapter } = await baseAuth.$context;

        instrumentUserRowDelete(internalAdapter);
      },
      userRowExists: async (userId: string) => {
        const { internalAdapter } = await baseAuth.$context;

        return Boolean(await internalAdapter.findUserById(userId));
      },
    }),
  };

  return { auth, capabilities, polarClient: polarClient ?? null };
};

type KeeperMcpEnabledAuth<TAuth = ReturnType<typeof betterAuth>> = TAuth & {
  api: KeeperMcpAuthApi;
};

const isKeeperMcpEnabledAuth = <TAuth extends { api: object }>(
  auth: TAuth,
): auth is TAuth & { api: KeeperMcpAuthApi } => {
  if (!("getMcpSession" in auth.api)) {
    return false;
  }
  if (!("getMCPProtectedResource" in auth.api)) {
    return false;
  }
  if (!("getMcpOAuthConfig" in auth.api)) {
    return false;
  }
  return true;
};

type AuthResult = ReturnType<typeof createAuth>;

export {
  createAuth,
  hasOAuthProviderApi,
  isKeeperMcpEnabledAuth,
};
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
export {
  deleteUserResidueUnavailable,
  deleteUserTeardownUnavailable,
  RESIDUE_WRITE_FAILED_SLUG,
  SYNC_TEARDOWN_TIMEOUT_MS,
  TEARDOWN_BLOCKED_ERROR_NAME,
} from "./delete-user-teardown";
export type {
  DeleteUserResidueDraft,
  DeleteUserResidueRecorder,
  DeleteUserTeardown,
  DeleteUserTeardownStep,
} from "./delete-user-teardown";
export type {
  AuthConfig,
  AuthResult,
  KeeperMcpAuthApi,
  KeeperMcpAuthSession,
  KeeperMcpEnabledAuth,
};
