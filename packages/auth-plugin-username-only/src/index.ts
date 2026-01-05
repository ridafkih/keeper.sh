import type { BetterAuthPlugin } from "better-auth";
import { resolveConfig, type UsernameOnlyOptions } from "./utils/config";
import { schema } from "./utils/schema";
import { createSignUpEndpoint } from "./endpoints/sign-up";
import { createSignInEndpoint } from "./endpoints/sign-in";

export type { UsernameOnlyOptions } from "./utils/config";

export const usernameOnly = (options?: UsernameOnlyOptions): BetterAuthPlugin => {
  const config = resolveConfig(options);

  return {
    id: "username-only",
    schema,
    endpoints: {
      signUpUsername: createSignUpEndpoint(config),
      signInUsername: createSignInEndpoint(),
    },
  };
};
