import { decryptPassword, encryptPassword } from "./encryption";

const ENCRYPTED_TOKEN_NAMESPACE = "enc:";
const ENCRYPTED_TOKEN_VERSION = "v1";
const ENCRYPTED_TOKEN_MARKER = `${ENCRYPTED_TOKEN_NAMESPACE}${ENCRYPTED_TOKEN_VERSION}:`;

declare const storedTokenBrand: unique symbol;

interface StoredToken {
  readonly [storedTokenBrand]: true;
  readonly stored: string;
}

type TokenDecryptionReason = "missing-key" | "unsupported-version" | "unreadable";

class TokenDecryptionError extends Error {
  readonly reason: TokenDecryptionReason;
  readonly requiresReauthentication: boolean;

  constructor(reason: TokenDecryptionReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TokenDecryptionError";
    this.reason = reason;
    this.requiresReauthentication = reason === "unreadable";
  }
}

class TokenEncryptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TokenEncryptionError";
  }
}

const readStoredToken = (stored: string): StoredToken => ({ stored }) as StoredToken;

const storedTokenValue = (token: StoredToken): string => token.stored;

const isTokenEncrypted = (token: StoredToken): boolean =>
  token.stored.startsWith(ENCRYPTED_TOKEN_NAMESPACE);

const encryptToken = (plaintext: string, key: string | undefined): StoredToken => {
  if (!key) {
    throw new TokenEncryptionError(
      "ENCRYPTION_KEY is required to store OAuth tokens",
    );
  }

  if (plaintext.length === 0) {
    throw new TokenEncryptionError("Refusing to store an empty OAuth token");
  }

  if (plaintext.startsWith(ENCRYPTED_TOKEN_NAMESPACE)) {
    throw new TokenEncryptionError(
      "Refusing to encrypt a value that is already an encrypted OAuth token",
    );
  }

  try {
    return readStoredToken(`${ENCRYPTED_TOKEN_MARKER}${encryptPassword(plaintext, key)}`);
  } catch (error) {
    throw new TokenEncryptionError("Failed to encrypt OAuth token", { cause: error });
  }
};

const decryptToken = (token: StoredToken, key: string | undefined): string => {
  if (!isTokenEncrypted(token)) {
    return token.stored;
  }

  if (!token.stored.startsWith(ENCRYPTED_TOKEN_MARKER)) {
    throw new TokenDecryptionError(
      "unsupported-version",
      "Stored OAuth token uses an unsupported encryption format version",
    );
  }

  if (!key) {
    throw new TokenDecryptionError(
      "missing-key",
      "ENCRYPTION_KEY is required to read an encrypted OAuth token",
    );
  }

  const payload = token.stored.slice(ENCRYPTED_TOKEN_MARKER.length);

  const plaintext = ((): string => {
    try {
      return decryptPassword(payload, key);
    } catch (error) {
      throw new TokenDecryptionError(
        "unreadable",
        "Stored OAuth token could not be decrypted",
        { cause: error },
      );
    }
  })();

  if (plaintext.length === 0) {
    throw new TokenDecryptionError(
      "unreadable",
      "Stored OAuth token decrypted to an empty value",
    );
  }

  return plaintext;
};

export {
  ENCRYPTED_TOKEN_MARKER,
  TokenDecryptionError,
  TokenEncryptionError,
  decryptToken,
  encryptToken,
  isTokenEncrypted,
  readStoredToken,
  storedTokenValue,
};
export type { StoredToken, TokenDecryptionReason };
