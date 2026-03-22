class OAuthProviderNotFoundError extends Error {
  constructor(provider: string) {
    super(`OAuth provider not found: ${provider}`);
  }
}

class DestinationAccountOwnershipError extends Error {
  constructor() {
    super("This account is already linked to another user");
  }
}

class OAuthCredentialCreateError extends Error {
  constructor() {
    super("Failed to create OAuth credentials");
  }
}

class CalDAVCredentialCreateError extends Error {
  constructor() {
    super("Failed to create CalDAV credentials");
  }
}

class DestinationAccountCreateError extends Error {
  constructor() {
    super("Failed to create calendar account");
  }
}

export {
  OAuthProviderNotFoundError,
  DestinationAccountOwnershipError,
  OAuthCredentialCreateError,
  CalDAVCredentialCreateError,
  DestinationAccountCreateError,
};
