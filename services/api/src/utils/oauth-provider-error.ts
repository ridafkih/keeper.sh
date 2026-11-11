const PROVIDER_ERROR_TOKEN_PATTERN = /^[a-z0-9_]{1,64}$/i;
const AADSTS_CODE_PATTERN = /AADSTS\d+/;

const readErrorToken = (value: string | null): string | null => {
  if (!value || !PROVIDER_ERROR_TOKEN_PATTERN.test(value)) {
    return null;
  }
  return value;
};

const readAadstsCode = (description: string | null): string | null =>
  description?.match(AADSTS_CODE_PATTERN)?.[0] ?? null;

interface OAuthProviderError {
  error: string | null;
  subcode: string | null;
  code: string | null;
}

const readOAuthProviderError = (searchParams: URLSearchParams): OAuthProviderError => ({
  code: readAadstsCode(searchParams.get("error_description")),
  error: readErrorToken(searchParams.get("error")),
  subcode: readErrorToken(searchParams.get("error_subcode")),
});

export { readOAuthProviderError };
export type { OAuthProviderError };
