import { createAuthEndpoint } from "better-auth/api";
import { APIError } from "better-call";
import { z } from "zod";
import type { CredentialAccount, User } from "../types";

const INVALID_CREDENTIALS_ERROR = {
  message: "invalid username or password",
};

const createSignInEndpoint = () =>
  createAuthEndpoint(
    "/username-only/sign-in",
    {
      body: z.object({
        password: z.string(),
        username: z.string().regex(/^[a-zA-Z0-9._-]+$/),
      }),
      method: "POST",
    },
    async (context) => {
      const { username, password } = context.body;

      const user = await context.context.adapter.findOne<User>({
        model: "user",
        where: [{ field: "username", value: username }],
      });

      if (!user) {
        throw new APIError("UNAUTHORIZED", INVALID_CREDENTIALS_ERROR);
      }

      const account = await context.context.adapter.findOne<CredentialAccount>({
        model: "account",
        where: [
          { field: "userId", value: user.id },
          { field: "providerId", value: "credential" },
        ],
      });

      if (!account?.password) {
        throw new APIError("UNAUTHORIZED", INVALID_CREDENTIALS_ERROR);
      }

      const valid = await context.context.password.verify({
        hash: account.password,
        password,
      });

      if (!valid) {
        throw new APIError("UNAUTHORIZED", INVALID_CREDENTIALS_ERROR);
      }

      const session = await context.context.internalAdapter.createSession(user.id, false);

      await context.setSignedCookie(
        context.context.authCookies.sessionToken.name,
        session.token,
        context.context.secret,
        context.context.authCookies.sessionToken.options,
      );

      return context.json({ session, user });
    },
  );

export { createSignInEndpoint };
