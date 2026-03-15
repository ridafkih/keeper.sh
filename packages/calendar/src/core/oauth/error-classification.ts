const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isOAuthReauthRequiredError = (error: unknown): boolean => {
  if (isRecord(error) && "oauthReauthRequired" in error) {
    return error.oauthReauthRequired === true;
  }

  if (error instanceof Error) {
    return error.message.toLowerCase().includes("invalid_grant");
  }

  return false;
};

export { isOAuthReauthRequiredError };
