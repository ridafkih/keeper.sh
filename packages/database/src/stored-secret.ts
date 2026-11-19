import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { secretbox } from "tweetnacl";
import { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } from "tweetnacl-util";
import type { EncryptionKey, Keyring } from "./keyring";

const ENCRYPTED_SECRET_NAMESPACE = "enc";
const ENCRYPTED_SECRET_VERSION = "v1";
const ENCRYPTED_SECRET_PREFIX = `${ENCRYPTED_SECRET_NAMESPACE}:`;
const ENCRYPTED_SECRET_MARKER = `${ENCRYPTED_SECRET_PREFIX}${ENCRYPTED_SECRET_VERSION}:`;
const FIELD_SEPARATOR = ":";
const VERSIONED_FIELD_COUNT = 5;
const KEY_ID_FIELD = 2;
const NONCE_FIELD = 3;
const SEALED_FIELD = 4;
const LEGACY_FIELD_COUNT = 2;
const AEAD_ALGORITHM = "aes-256-gcm";
const AEAD_NONCE_BYTES = 12;
const AEAD_TAG_BYTES = 16;
const KEY_ID_PATTERN = /^[0-9a-f]{16}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const SECRET_PURPOSES = {
  "caldav_credentials.encryptedPassword": { unversioned: "secretbox" },
  "oauth_credentials.accessToken": { unversioned: "plaintext" },
  "oauth_credentials.refreshToken": { unversioned: "plaintext" },
} as const;

type SecretPurpose = keyof typeof SECRET_PURPOSES;

declare const storedSecretBrand: unique symbol;

interface StoredSecret<Purpose extends SecretPurpose = SecretPurpose> {
  readonly [storedSecretBrand]: Purpose;
  readonly purpose: Purpose;
  readonly stored: string;
}

type SecretDecryptionReason =
  | "missing-key"
  | "unsupported-version"
  | "malformed"
  | "unreadable";

class SecretDecryptionError extends Error {
  readonly reason: SecretDecryptionReason;
  readonly purpose: SecretPurpose;

  constructor(
    reason: SecretDecryptionReason,
    purpose: SecretPurpose,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SecretDecryptionError";
    this.reason = reason;
    this.purpose = purpose;
  }
}

class SecretEncryptionError extends Error {
  readonly purpose: SecretPurpose;

  constructor(purpose: SecretPurpose, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecretEncryptionError";
    this.purpose = purpose;
  }
}

const REDACTED_SECRET = "[stored secret]";
const INSPECT_SYMBOL = Symbol.for("nodejs.util.inspect.custom");

const redactSecret = (): string => REDACTED_SECRET;

const storedSecretPrototype = {
  [INSPECT_SYMBOL]: redactSecret,
  toJSON: redactSecret,
  toString: redactSecret,
};

const readStoredSecret = <Purpose extends SecretPurpose>(
  purpose: Purpose,
  stored: string,
): StoredSecret<Purpose> =>
  Object.assign(Object.create(storedSecretPrototype), { purpose, stored });

const storedSecretValue = (secret: StoredSecret): string => secret.stored;

const hasStoredSecret = <Secret extends StoredSecret>(
  secret?: Secret | null,
): secret is Secret => typeof secret?.stored === "string" && secret.stored.length > 0;

const isSecretVersioned = (secret: StoredSecret): boolean =>
  secret.stored.startsWith(ENCRYPTED_SECRET_PREFIX);

const readSecretKeyId = (secret: StoredSecret): string | null => {
  if (!secret.stored.startsWith(ENCRYPTED_SECRET_MARKER)) {
    return null;
  }
  const keyId = secret.stored.split(FIELD_SEPARATOR)[KEY_ID_FIELD];
  if (!keyId || !KEY_ID_PATTERN.test(keyId)) {
    return null;
  }
  return keyId;
};

const buildAssociatedData = (purpose: SecretPurpose, keyId: string, rowId: string): Buffer =>
  Buffer.from(
    JSON.stringify([ENCRYPTED_SECRET_VERSION, keyId, purpose, rowId.toLowerCase()]),
    "utf8",
  );

const sealVersioned = (
  purpose: SecretPurpose,
  plaintext: string,
  key: EncryptionKey,
  rowId: string,
): string => {
  const nonce = randomBytes(AEAD_NONCE_BYTES);
  const cipher = createCipheriv(AEAD_ALGORITHM, key.aeadKey, nonce, {
    authTagLength: AEAD_TAG_BYTES,
  });
  cipher.setAAD(buildAssociatedData(purpose, key.id, rowId));
  const sealed = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  return [
    ENCRYPTED_SECRET_NAMESPACE,
    ENCRYPTED_SECRET_VERSION,
    key.id,
    nonce.toString("base64url"),
    sealed.toString("base64url"),
  ].join(FIELD_SEPARATOR);
};

const decodeBase64Url = (purpose: SecretPurpose, value: string): Buffer => {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new SecretDecryptionError("malformed", purpose, "Stored secret is not well formed");
  }
  return Buffer.from(value, "base64url");
};

const openVersioned = (secret: StoredSecret, keyring: Keyring, rowId: string): string => {
  const { purpose, stored } = secret;

  if (!stored.startsWith(ENCRYPTED_SECRET_MARKER)) {
    throw new SecretDecryptionError(
      "unsupported-version",
      purpose,
      "Stored secret uses an unsupported encryption format version",
    );
  }

  const fields = stored.split(FIELD_SEPARATOR);
  const keyId = fields[KEY_ID_FIELD];
  const encodedNonce = fields[NONCE_FIELD];
  const encodedSealed = fields[SEALED_FIELD];
  if (
    fields.length !== VERSIONED_FIELD_COUNT
    || !keyId
    || !encodedNonce
    || !encodedSealed
    || !KEY_ID_PATTERN.test(keyId)
  ) {
    throw new SecretDecryptionError("malformed", purpose, "Stored secret is not well formed");
  }

  const nonce = decodeBase64Url(purpose, encodedNonce);
  const sealed = decodeBase64Url(purpose, encodedSealed);
  if (nonce.length !== AEAD_NONCE_BYTES || sealed.length < AEAD_TAG_BYTES) {
    throw new SecretDecryptionError("malformed", purpose, "Stored secret is not well formed");
  }

  const key = keyring.resolve().byId.get(keyId);
  if (!key) {
    throw new SecretDecryptionError(
      "missing-key",
      purpose,
      `No configured encryption key matches key id ${keyId}`,
    );
  }

  try {
    const decipher = createDecipheriv(AEAD_ALGORITHM, key.aeadKey, nonce, {
      authTagLength: AEAD_TAG_BYTES,
    });
    decipher.setAAD(buildAssociatedData(purpose, keyId, rowId));
    decipher.setAuthTag(sealed.subarray(sealed.length - AEAD_TAG_BYTES));
    return Buffer.concat([
      decipher.update(sealed.subarray(0, sealed.length - AEAD_TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    throw new SecretDecryptionError(
      "unreadable",
      purpose,
      "Stored secret could not be decrypted",
      { cause: error },
    );
  }
};

const sealLegacy = (plaintext: string, key: EncryptionKey): string => {
  const nonce = randomBytes(secretbox.nonceLength);
  const sealed = secretbox(decodeUTF8(plaintext), nonce, key.legacyKey);
  return `${encodeBase64(nonce)}${FIELD_SEPARATOR}${encodeBase64(sealed)}`;
};

const decodeLegacyField = (purpose: SecretPurpose, value: string): Uint8Array => {
  try {
    return decodeBase64(value);
  } catch (error) {
    throw new SecretDecryptionError("malformed", purpose, "Stored secret is not well formed", {
      cause: error,
    });
  }
};

const openLegacy = (secret: StoredSecret, keyring: Keyring): string => {
  const { purpose, stored } = secret;
  const fields = stored.split(FIELD_SEPARATOR);
  const [encodedNonce, encodedSealed] = fields;
  if (fields.length !== LEGACY_FIELD_COUNT || !encodedNonce || !encodedSealed) {
    throw new SecretDecryptionError("malformed", purpose, "Stored secret is not well formed");
  }

  const { ordered } = keyring.resolve();
  if (ordered.length === 0) {
    throw new SecretDecryptionError(
      "missing-key",
      purpose,
      "ENCRYPTION_KEY is required to read an encrypted secret",
    );
  }

  const nonce = decodeLegacyField(purpose, encodedNonce);
  const sealed = decodeLegacyField(purpose, encodedSealed);
  if (nonce.length !== secretbox.nonceLength) {
    throw new SecretDecryptionError("malformed", purpose, "Stored secret is not well formed");
  }

  for (const key of ordered) {
    const opened = secretbox.open(sealed, nonce, key.legacyKey);
    if (opened) {
      return encodeUTF8(opened);
    }
  }

  throw new SecretDecryptionError("unreadable", purpose, "Stored secret could not be decrypted");
};

const requirePrimaryKey = (purpose: SecretPurpose, keyring: Keyring): EncryptionKey => {
  const { primary } = keyring.resolve();
  if (!primary) {
    throw new SecretEncryptionError(purpose, "ENCRYPTION_KEY is required to encrypt a secret");
  }
  return primary;
};

const assertSealable = (purpose: SecretPurpose, plaintext: string): void => {
  if (
    SECRET_PURPOSES[purpose].unversioned === "plaintext"
    && plaintext.startsWith(ENCRYPTED_SECRET_PREFIX)
  ) {
    throw new SecretEncryptionError(
      purpose,
      "Refusing to store a value that is already an encrypted secret",
    );
  }
};

const encryptSecret = <Purpose extends SecretPurpose>(
  purpose: Purpose,
  plaintext: string,
  keyring: Keyring,
  rowId: string,
): StoredSecret<Purpose> => {
  assertSealable(purpose, plaintext);
  return readStoredSecret(
    purpose,
    sealVersioned(purpose, plaintext, requirePrimaryKey(purpose, keyring), rowId),
  );
};

const sealSecret = <Purpose extends SecretPurpose>(
  purpose: Purpose,
  plaintext: string,
  keyring: Keyring,
  rowId: string,
): StoredSecret<Purpose> => {
  if (keyring.encryptOnWrite) {
    return encryptSecret(purpose, plaintext, keyring, rowId);
  }

  assertSealable(purpose, plaintext);
  if (SECRET_PURPOSES[purpose].unversioned === "plaintext") {
    return readStoredSecret(purpose, plaintext);
  }
  return readStoredSecret(purpose, sealLegacy(plaintext, requirePrimaryKey(purpose, keyring)));
};

const openSecret = (secret: StoredSecret, keyring: Keyring, rowId: string): string => {
  if (isSecretVersioned(secret)) {
    return openVersioned(secret, keyring, rowId);
  }
  if (SECRET_PURPOSES[secret.purpose].unversioned === "plaintext") {
    return secret.stored;
  }
  return openLegacy(secret, keyring);
};

export {
  ENCRYPTED_SECRET_MARKER,
  SecretDecryptionError,
  SecretEncryptionError,
  encryptSecret,
  hasStoredSecret,
  isSecretVersioned,
  openSecret,
  readSecretKeyId,
  readStoredSecret,
  sealSecret,
  storedSecretValue,
};
export type { SecretDecryptionReason, SecretPurpose, StoredSecret };
