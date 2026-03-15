import { getProvider } from "@keeper.sh/calendar";

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

const getProviderName = (providerId: string): string =>
  toNonEmptyValue(getProvider(providerId)?.name) ?? providerId;

const getProviderIcon = (providerId: string): string | null =>
  toNonEmptyValue(getProvider(providerId)?.icon);

const getAccountIdentifier = (input: AccountDisplayInput): string | null =>
  toNonEmptyValue(input.email)
  ?? toNonEmptyValue(input.accountIdentifier)
  ?? toNonEmptyValue(input.displayName);

const getAccountLabel = (input: AccountDisplayInput): string =>
  getAccountIdentifier(input) ?? getProviderName(input.provider);

const withProviderMetadata = <DisplayValue extends { provider: string }>(value: DisplayValue): DisplayValue & {
  providerName: string;
  providerIcon: string | null;
} => ({
  ...value,
  providerName: getProviderName(value.provider),
  providerIcon: getProviderIcon(value.provider),
});

const withAccountDisplay = <DisplayValue extends AccountDisplayInput>(value: DisplayValue): DisplayValue & {
  accountLabel: string;
  accountIdentifier: string | null;
  providerName: string;
  providerIcon: string | null;
} => ({
  ...withProviderMetadata(value),
  accountLabel: getAccountLabel(value),
  accountIdentifier: getAccountIdentifier(value),
});

export { withProviderMetadata, withAccountDisplay };
