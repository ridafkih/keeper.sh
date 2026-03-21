class OAuthProviderConfigError extends Error {
  constructor(provider: "google" | "microsoft") {
    super(`${provider === "google" ? "Google" : "Microsoft"} OAuth not configured`);
    this.name = "OAuthProviderConfigError";
  }
}

const resolveOAuthProviderConfig = (
  provider: "google" | "microsoft",
  clientId: string | undefined,
  clientSecret: string | undefined,
): { clientId: string; clientSecret: string } => {
  if (!clientId || !clientSecret) {
    throw new OAuthProviderConfigError(provider);
  }
  return { clientId, clientSecret };
};

export { resolveOAuthProviderConfig, OAuthProviderConfigError };
