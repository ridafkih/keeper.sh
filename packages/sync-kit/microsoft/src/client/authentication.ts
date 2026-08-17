import type { AuthenticationProvider } from "@microsoft/microsoft-graph-client";

interface HeldTokenOptions {
  readonly getAccessToken: () => Promise<string>;
}

const createHeldTokenAuthenticationProvider = (
  options: HeldTokenOptions,
): AuthenticationProvider => ({
  getAccessToken: () => options.getAccessToken(),
});

export { createHeldTokenAuthenticationProvider };
export type { HeldTokenOptions };
