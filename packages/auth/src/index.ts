import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { passkey as passkeyPlugin } from "@better-auth/passkey";
import { checkout, polar, portal } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";
import { Resend } from "resend";
import { usernameOnly } from "@keeper.sh/auth-plugin-username-only";
import {
  user as userTable,
  session as sessionTable,
  account as accountTable,
  verification as verificationTable,
  passkey as passkeyTable,
} from "@keeper.sh/database/auth-schema";
import { signUpBodySchema } from "@keeper.sh/data-schemas";
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
  resendApiKey?: string;
  passkeyRpId?: string;
  passkeyRpName?: string;
  passkeyOrigin?: string;
  trustedOrigins?: string[];
}

interface AuthResult {
  auth: ReturnType<typeof betterAuth>;
  polarClient: Polar | null;
}

const createAuth = (config: AuthConfig): AuthResult => {
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
    resendApiKey,
    passkeyRpId,
    passkeyRpName,
    passkeyOrigin,
    trustedOrigins,
  } = config;

  const buildResendClient = (): Resend | null => {
    if (resendApiKey) {
      return new Resend(resendApiKey);
    }
    return null;
  };

  const resend = buildResendClient();

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

  const socialProviders: Parameters<typeof betterAuth>[0]["socialProviders"] = {
    // Empty object to be populated conditionally below
  };

  if (googleClientId && googleClientSecret) {
    socialProviders.google = {
      accessType: "offline",
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/calendar.events"],
    };
  }

  const auth = betterAuth({
    account: {
      accountLinking: {
        allowDifferentEmails: true,
      },
    },
    baseURL: baseUrl,
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: {
        account: accountTable,
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
        const { email } = signUpBodySchema.assert(context.body);
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
          process.stderr.write(
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

          await polarClient.customers.deleteExternal({
            externalId: user.id,
          });
        },
        enabled: true,
      },
    },
  });

  return { auth, polarClient: polarClient ?? null };
};

export { createAuth };
export type { AuthConfig, AuthResult };
