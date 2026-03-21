const OAUTH_PROVIDER_NAMES = ["google", "outlook"] as const;
const CALDAV_PROVIDER_NAMES = ["caldav", "fastmail", "icloud"] as const;

type OAuthProviderName = (typeof OAUTH_PROVIDER_NAMES)[number];
type CaldavProviderName = (typeof CALDAV_PROVIDER_NAMES)[number];

interface OAuthConfig {
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
}

const ProviderResolutionStatus = {
  MISCONFIGURED_PROVIDER: "MISCONFIGURED_PROVIDER",
  MISSING_PROVIDER_CREDENTIALS: "MISSING_PROVIDER_CREDENTIALS",
  RESOLVED: "RESOLVED",
  UNSUPPORTED_PROVIDER: "UNSUPPORTED_PROVIDER",
} as const;

type ProviderResolutionStatus =
  (typeof ProviderResolutionStatus)[keyof typeof ProviderResolutionStatus];

type UnresolvedProviderResolutionStatus = Exclude<
  ProviderResolutionStatus,
  typeof ProviderResolutionStatus.RESOLVED
>;

const unresolvedProviderResolutionStatuses: readonly UnresolvedProviderResolutionStatus[] = [
  ProviderResolutionStatus.MISCONFIGURED_PROVIDER,
  ProviderResolutionStatus.MISSING_PROVIDER_CREDENTIALS,
  ProviderResolutionStatus.UNSUPPORTED_PROVIDER,
] as const;

const OAUTH_PROVIDER_SET = new Set<string>(OAUTH_PROVIDER_NAMES);
const CALDAV_PROVIDER_SET = new Set<string>(CALDAV_PROVIDER_NAMES);

const oauthProviderConfigValidators: Record<OAuthProviderName, (config: OAuthConfig) => boolean> = {
  google: (config) => Boolean(config.googleClientId && config.googleClientSecret),
  outlook: (config) => Boolean(config.microsoftClientId && config.microsoftClientSecret),
};

const isOAuthProviderName = (provider: string): provider is OAuthProviderName =>
  OAUTH_PROVIDER_SET.has(provider);

const isCaldavProviderName = (provider: string): provider is CaldavProviderName =>
  CALDAV_PROVIDER_SET.has(provider);

const hasOAuthProviderConfig = (
  provider: OAuthProviderName,
  oauthConfig: OAuthConfig,
): boolean => oauthProviderConfigValidators[provider](oauthConfig);

const resolveProviderSupportStatus = (
  provider: string,
  encryptionKey?: string,
): UnresolvedProviderResolutionStatus => {
  if (isOAuthProviderName(provider)) {
    return ProviderResolutionStatus.MISCONFIGURED_PROVIDER;
  }

  if (!isCaldavProviderName(provider)) {
    return ProviderResolutionStatus.UNSUPPORTED_PROVIDER;
  }

  if (!encryptionKey) {
    return ProviderResolutionStatus.MISCONFIGURED_PROVIDER;
  }

  return ProviderResolutionStatus.MISSING_PROVIDER_CREDENTIALS;
};

const toUnresolvedProviderStatusCode = (
  status: UnresolvedProviderResolutionStatus,
): string => status.toLowerCase();

export {
  ProviderResolutionStatus,
  hasOAuthProviderConfig,
  isCaldavProviderName,
  isOAuthProviderName,
  resolveProviderSupportStatus,
  toUnresolvedProviderStatusCode,
  unresolvedProviderResolutionStatuses,
};
export type {
  CaldavProviderName,
  OAuthConfig,
  OAuthProviderName,
  UnresolvedProviderResolutionStatus,
};
