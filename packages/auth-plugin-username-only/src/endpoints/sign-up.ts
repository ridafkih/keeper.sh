import { createAuthEndpoint } from "better-auth/api";
import { APIError } from "better-call";
import { z } from "zod";
import type { UsernameOnlyConfig } from "../utils/config";
import type { User } from "../types";

export const createSignUpEndpoint = (config: UsernameOnlyConfig) =>
  createAuthEndpoint(
    "/username-only/sign-up",
    {
      method: "POST",
      body: z.object({
        username: z
          .string()
          .min(config.minUsernameLength)
          .max(config.maxUsernameLength)
          .regex(
            /^[a-zA-Z0-9._-]+$/,
            "username can only contain letters, numbers, dots, underscores, and hyphens",
          ),
        password: z.string().min(config.minPasswordLength).max(config.maxPasswordLength),
        name: z.string().optional(),
      }),
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
        model: "user",
        data: {
          username,
          name: name ?? username,
          email: `${username}@local`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      await context.context.adapter.create({
        model: "account",
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: hashedPassword,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const session = await context.context.internalAdapter.createSession(user.id, false);

      await context.setSignedCookie(
        context.context.authCookies.sessionToken.name,
        session.token,
        context.context.secret,
        context.context.authCookies.sessionToken.options,
      );

      return context.json({ user, session });
    },
  );
