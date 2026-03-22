class CalDAVSourceLimitError extends Error {
  constructor() {
    super("Account limit reached. Upgrade to Pro for unlimited accounts.");
  }
}

class DuplicateCalDAVSourceError extends Error {
  constructor() {
    super("This calendar is already added as a source");
  }
}

class CalDAVSourceCredentialCreateError extends Error {
  constructor() {
    super("Failed to create CalDAV source credential");
  }
}

class CalDAVSourceAccountCreateError extends Error {
  constructor() {
    super("Failed to create calendar account");
  }
}

class CalDAVSourceMissingCalendarUrlError extends Error {
  constructor(sourceId: string) {
    super(`CalDAV source ${sourceId} is missing calendarUrl`);
  }
}

class CalDAVEncryptionKeyMissingError extends Error {
  constructor() {
    super("Encryption key not configured");
  }
}

class CalDAVSourceCreateError extends Error {
  constructor() {
    super("Failed to create CalDAV source");
  }
}

class CalDAVSourceProvisioningInvariantError extends Error {
  constructor() {
    super("Invariant violated: source provisioning did not request bootstrap sync");
  }
}

export {
  CalDAVSourceLimitError,
  DuplicateCalDAVSourceError,
  CalDAVSourceCredentialCreateError,
  CalDAVSourceAccountCreateError,
  CalDAVSourceMissingCalendarUrlError,
  CalDAVEncryptionKeyMissingError,
  CalDAVSourceCreateError,
  CalDAVSourceProvisioningInvariantError,
};
