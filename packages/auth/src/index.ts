import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { polar, checkout, portal } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";
import { usernameOnly } from "@keeper.sh/auth-plugin-username-only";
import { database } from "@keeper.sh/database";
import * as authSchema from "@keeper.sh/database/auth-schema";
import env from "@keeper.sh/env/auth";
import type { BetterAuthPlugin } from "better-auth";

const plugins: BetterAuthPlugin[] = [];

if (env.NO_EMAIL_REQUIRED) {
  plugins.push(usernameOnly());
}

const polarClient =
  env.POLAR_ACCESS_TOKEN && env.POLAR_MODE
    ? new Polar({
        accessToken: env.POLAR_ACCESS_TOKEN,
        server: env.POLAR_MODE,
      })
    : null;

if (polarClient) {
  plugins.push(
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      use: [
        checkout({
          successUrl: "/dashboard/billing?success=true",
        }),
        portal(),
      ],
    }),
  );
}

export const auth = betterAuth({
  database: drizzleAdapter(database, {
    provider: "pg",
    schema: authSchema,
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: !env.NO_EMAIL_REQUIRED,
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
  plugins,
});
