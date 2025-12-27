import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";
import { polarClient } from "@polar-sh/better-auth";

const plugins = [passkeyClient()];

if (process.env.NEXT_PUBLIC_COMMERCIAL_MODE === "true") {
  plugins.push(polarClient());
}

export const authClient = createAuthClient({ plugins });
