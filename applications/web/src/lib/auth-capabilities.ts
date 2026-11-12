import { authCapabilitiesSchema } from "@keeper.sh/data-schemas";
import type { AuthCapabilities } from "@keeper.sh/data-schemas";
import type { AppJsonFetcher } from "./router-context";

type SocialProviderId = keyof AuthCapabilities["socialProviders"];

interface CredentialField {
  autoComplete: string;
  id: string;
  label: string;
  name: string;
  placeholder: string;
  type: "email" | "text";
}

const resolveCredentialField = (
  capabilities: AuthCapabilities,
): CredentialField => {
  if (capabilities.credentialMode === "username") {
    return {
      autoComplete: "username",
      id: "username",
      label: "Username",
      name: "username",
      placeholder: "johndoe",
      type: "text",
    };
  }

  return {
    autoComplete: "email",
    id: "email",
    label: "Email",
    name: "email",
    placeholder: "johndoe+keeper@example.com",
    type: "email",
  };
};

const getEnabledSocialProviders = (
  capabilities: AuthCapabilities,
): SocialProviderId[] => {
  /**
   * TODO: Move this to providers, and have it based off
   * the defined metadata.
   * @param providerName
   */
  const isValidProvider = (
    providerName: string,
  ): providerName is "google" | "microsoft" | "oidc" => {
    if (providerName === "google") return true;
    if (providerName === "microsoft") return true;
    if (providerName === "oidc") return true;
    return false;
  }

  const providers: SocialProviderId[] = [];
  for (const [provider, enabled] of Object.entries(capabilities.socialProviders)) {
    if (!isValidProvider(provider) || !enabled) continue;
    providers.push(provider)
  }

  return providers;
}

const resolveOidcProviderName = (
  capabilities: AuthCapabilities,
): string => capabilities.oidcProviderName ?? "SSO";

const supportsPasskeys = (capabilities: AuthCapabilities): boolean =>
  capabilities.supportsPasskeys;

const fetchAuthCapabilitiesWithApi = async (
  fetchApi: AppJsonFetcher,
): Promise<AuthCapabilities> => {
  const data = await fetchApi<unknown>("/api/auth/capabilities");
  return authCapabilitiesSchema.assert(data);
};

export {
  fetchAuthCapabilitiesWithApi,
  getEnabledSocialProviders,
  resolveCredentialField,
  resolveOidcProviderName,
  supportsPasskeys,
};
export type { AuthCapabilities, CredentialField, SocialProviderId };
