import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";

export const authClient = createAuthClient({
  fetchOptions: { credentials: "include" },
  plugins: [passkeyClient()],
});
