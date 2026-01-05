import { createAuthEndpoint } from "better-auth/api";
import { APIError } from "better-call";
import { z } from "zod";
import type { UsernameOnlyConfig } from "../utils/config";
import type { User } from "../types";

const createSignUpEndpoint = (config: UsernameOnlyConfig) =>
  createAuthEndpoint(
    "/username-only/sign-up",
    {
      body: z.object({
        name: z.string().optional(),
        password: z.string().min(config.minPasswordLength).max(config.maxPasswordLength),
        username: z
          .string()
          .min(config.minUsernameLength)
          .max(config.maxUsernameLength)
          .regex(
            /^[a-zA-Z0-9._-]+$/,
            "username can only contain letters, numbers, dots, underscores, and hyphens",
          ),
      }),
      method: "POST",
    },
    async (context) => {
      const { username, password, name } = context.body;

      const existingUser = await context.context.adapter.findOne<User>({
        model: "user",
        where: [{ field: "username", value: username }],
      });

      if (existingUser) {
        throw new APIError("BAD_REQUEST", {
          message: "username already taken",
        });
      }

      const hashedPassword = await context.context.password.hash(password);

      const user = await context.context.adapter.create<User>({
        data: {
          createdAt: new Date(),
          email: `${username}@local`,
          emailVerified: true,
          name: name ?? username,
          updatedAt: new Date(),
          username,
        },
        model: "user",
      });

      await context.context.adapter.create({
        data: {
          accountId: user.id,
          createdAt: new Date(),
          password: hashedPassword,
          providerId: "credential",
          updatedAt: new Date(),
          userId: user.id,
        },
        model: "account",
      });

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

export { createSignUpEndpoint };
