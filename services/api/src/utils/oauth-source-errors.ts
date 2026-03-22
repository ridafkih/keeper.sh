class OAuthSourceLimitError extends Error {
  constructor() {
    super("Account limit reached. Upgrade to Pro for unlimited accounts.");
  }
}

class DestinationNotFoundError extends Error {
  constructor() {
    super("Destination not found or not owned by user");
  }
}

class DestinationProviderMismatchError extends Error {
  constructor(provider: string) {
    super(`Destination is not a ${provider} account`);
  }
}

class DuplicateSourceError extends Error {
  constructor() {
    super("This calendar is already added as a source");
  }
}

class UnsupportedOAuthProviderError extends Error {
  constructor(operation: "source_create" | "account_import" | "calendar_listing", provider: string) {
    super(`Unsupported OAuth provider for ${operation}: ${provider}`);
  }
}

class OAuthSourceAccountCreateError extends Error {
  constructor() {
    super("Failed to create calendar account");
  }
}

class OAuthSourceCreateError extends Error {
  constructor() {
    super("Failed to create OAuth calendar source");
  }
}

class OAuthSourceProvisioningInvariantError extends Error {
  constructor() {
    super("Invariant violated: source provisioning did not request bootstrap sync");
  }
}

class OAuthImportAccountCreateError extends Error {
  constructor() {
    super("Failed to find or create calendar account");
  }
}

class SourceCredentialNotFoundError extends Error {
  constructor() {
    super("Source credential not found or not owned by user");
  }
}

class SourceCredentialProviderMismatchError extends Error {
  constructor(provider: string) {
    super(`Source credential is not a ${provider} account`);
  }
}

export {
  OAuthSourceLimitError,
  DestinationNotFoundError,
  DestinationProviderMismatchError,
  DuplicateSourceError,
  UnsupportedOAuthProviderError,
  OAuthSourceAccountCreateError,
  OAuthSourceCreateError,
  OAuthSourceProvisioningInvariantError,
  OAuthImportAccountCreateError,
  SourceCredentialNotFoundError,
  SourceCredentialProviderMismatchError,
};
