import type { BetterAuthPlugin } from "better-auth";
import { resolveConfig } from "./utils/config";
import type { UsernameOnlyOptions } from "./utils/config";
import { schema } from "./utils/schema";
import { createSignUpEndpoint } from "./endpoints/sign-up";
import { createSignInEndpoint } from "./endpoints/sign-in";

const usernameOnly = (options?: UsernameOnlyOptions): BetterAuthPlugin => {
  const config = resolveConfig(options);

  return {
    endpoints: {
      signInUsername: createSignInEndpoint(),
      signUpUsername: createSignUpEndpoint(config),
    },
    id: "username-only",
    schema,
  };
};

export { usernameOnly };
export type { UsernameOnlyOptions };
