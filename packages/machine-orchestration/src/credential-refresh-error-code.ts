enum CredentialRefreshErrorCode {
  INVALID_GRANT = "invalid_grant",
  TIMEOUT = "timeout",
  UNKNOWN = "unknown_error",
}

const resolveCredentialRefreshErrorCode = (
  error: unknown,
): CredentialRefreshErrorCode => {
  let message = String(error);
  if (error instanceof Error) {
    const { message: errorMessage } = error;
    message = errorMessage;
  }
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("invalid_grant")) {
    return CredentialRefreshErrorCode.INVALID_GRANT;
  }

  if (normalizedMessage.includes("timed out") || normalizedMessage.includes("timeout")) {
    return CredentialRefreshErrorCode.TIMEOUT;
  }

  return CredentialRefreshErrorCode.UNKNOWN;
};

export {
  CredentialRefreshErrorCode,
  resolveCredentialRefreshErrorCode,
};
