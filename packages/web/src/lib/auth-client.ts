import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";
import { polarClient } from "@polar-sh/better-auth";

export const authClient = createAuthClient({
  fetchOptions: {
    credentials: "include",
  },
  plugins: [passkeyClient(), polarClient()],
});
