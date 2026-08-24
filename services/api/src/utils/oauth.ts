const buildRedirectUrl = (
  path: string,
  baseUrl: string,
  params?: Record<string, string>,
): URL => {
  const url = new URL(path, baseUrl);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
};

class OAuthError extends Error {
  redirectUrl: URL;

  constructor(
    message: string,
    redirectUrl: URL,
  ) {
    super(message);
    this.name = "OAuthError";
    this.redirectUrl = redirectUrl;
  }
}

export {
  buildRedirectUrl,
  OAuthError,
};
