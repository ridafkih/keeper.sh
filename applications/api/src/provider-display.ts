import { getProvider } from "@keeper.sh/providers";

interface AccountDisplayInput {
  displayName: string | null;
  email: string | null;
  accountIdentifier: string | null;
  provider: string;
}

const toNonEmptyValue = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  if (normalizedValue.length > 0) {
    return normalizedValue;
  }

  return null;
};

const resolveProvider = (providerId: string) => {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  return provider;
};

const getProviderName = (providerId: string): string => {
  const provider = resolveProvider(providerId);
  const name = toNonEmptyValue(provider.name);
  if (!name) {
    throw new Error(`Provider "${providerId}" has no name configured`);
  }
  return name;
};

const getProviderIcon = (providerId: string): string | null => {
  const provider = resolveProvider(providerId);
  return toNonEmptyValue(provider.icon);
};

const getAccountIdentifier = (input: AccountDisplayInput): string => {
  const email = toNonEmptyValue(input.email);
  if (email) {
    return email;
  }

  const accountId = toNonEmptyValue(input.accountIdentifier);
  if (accountId) {
    return accountId;
  }

  const displayName = toNonEmptyValue(input.displayName);
  if (displayName) {
    return displayName;
  }

  throw new Error(`No identifier found for account with provider "${input.provider}"`);
};

const getAccountLabel = (input: AccountDisplayInput): string =>
  getAccountIdentifier(input);

const withProviderMetadata = <DisplayValue extends { provider: string }>(
  value: DisplayValue,
): DisplayValue & {
  providerName: string;
  providerIcon: string | null;
} => ({
  ...value,
  providerName: getProviderName(value.provider),
  providerIcon: getProviderIcon(value.provider),
});

const withAccountDisplay = <DisplayValue extends AccountDisplayInput>(
  value: DisplayValue,
): DisplayValue & {
  accountLabel: string;
  accountIdentifier: string;
  providerName: string;
  providerIcon: string | null;
} => ({
  ...withProviderMetadata(value),
  accountLabel: getAccountLabel(value),
  accountIdentifier: getAccountIdentifier(value),
});

export { withAccountDisplay, withProviderMetadata };
