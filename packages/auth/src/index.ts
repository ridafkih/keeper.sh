import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { passkey } from "@better-auth/passkey";
import { polar, checkout, portal } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";
import { Resend } from "resend";
import { usernameOnly } from "@keeper.sh/auth-plugin-username-only";
import * as authSchema from "@keeper.sh/database/auth-schema";
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

export interface AuthConfig {
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

export interface AuthResult {
  auth: ReturnType<typeof betterAuth>;
  polarClient: Polar | null;
}

export const createAuth = (config: AuthConfig): AuthResult => {
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

  const resend = resendApiKey ? new Resend(resendApiKey) : null;

  const plugins: BetterAuthPlugin[] = [];

  if (!commercialMode) {
    plugins.push(usernameOnly());
  }

  const polarClient =
    polarAccessToken && polarMode
      ? new Polar({
          accessToken: polarAccessToken,
          server: polarMode,
        })
      : null;

  if (polarClient) {
    const checkoutSuccessUrl = webBaseUrl
      ? new URL("/dashboard/billing?success=true", webBaseUrl).toString()
      : "/dashboard/billing?success=true";

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
      passkey({
        rpID: passkeyRpId,
        rpName: passkeyRpName,
        origin: passkeyOrigin,
      }),
    );
  }

  const socialProviders: Parameters<typeof betterAuth>[0]["socialProviders"] =
    {};

  if (googleClientId && googleClientSecret) {
    socialProviders.google = {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      accessType: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/calendar.events"],
    };
  }

  const auth = betterAuth({
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: authSchema,
    }),
    secret,
    baseURL: baseUrl,
    trustedOrigins,
    onAPIError: {
      onError(error: unknown) {
        if (typeof error !== "object" || error === null) return;
        if (!("body" in error) || typeof error.body !== "object" || error.body === null) return;
        if (!("message" in error.body) || typeof error.body.message !== "string") return;

        if (error.body.message.toLowerCase().includes("invalid origin")) {
          console.error(
            "A request has failed due to an origin mismatch. If this was meant to be a valid request, please set the `TRUSTED_ORIGINS` environment variable to include the origin you intend on accessing Keeper from.\n\nThis should be a comma-delimited array of values, for more information please refer to the documentation on GitHub. https://github.com/ridafkih/keeper.sh#accessing-keeper-from-non-localhost-urls",
          );
        }
      },
    },
    emailVerification: {
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }: SendEmailParams) => {
        if (!resend) return;
        await resend.emails.send({
          to: user.email,
          template: {
            id: "email-verification",
            variables: { url, name: user.name },
          },
        });
      },
    },
    emailAndPassword: {
      enabled: commercialMode,
      requireEmailVerification: commercialMode,
      sendResetPassword: async ({ user, url }: SendEmailParams) => {
        if (!resend) return;
        await resend.emails.send({
          to: user.email,
          template: {
            id: "password-reset",
            variables: { url, name: user.name },
          },
        });
      },
    },
    socialProviders,
    account: {
      accountLinking: {
        allowDifferentEmails: true,
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        afterDelete: async (user) => {
          if (!polarClient) return;

          await polarClient.customers.deleteExternal({
            externalId: user.id,
          });
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path !== "/sign-up/email") return;
        const { email } = signUpBodySchema.assert(context.body);
        const existingUser = await context.context.adapter.findOne<User>({
          model: "user",
          where: [
            { field: "email", value: email },
            { field: "emailVerified", value: false },
          ],
        });
        if (!existingUser) return;
        await context.context.internalAdapter.deleteUser(existingUser.id);
      }),
    },
    plugins,
  });

  return { auth, polarClient };
};
