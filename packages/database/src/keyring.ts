import { hkdfSync } from "node:crypto";
import { secretbox } from "tweetnacl";
import { decodeBase64 } from "tweetnacl-util";

const KEY_ID_BYTES = 8;
const AEAD_KEY_BYTES = 32;
const KEY_ID_INFO = "keeper.sh/credential-encryption/key-id";
const AEAD_KEY_INFO = "keeper.sh/credential-encryption/v1/aes-256-gcm";
const NO_SALT = new Uint8Array(0);
const KEY_LIST_SEPARATOR = ",";

interface EncryptionKey {
  readonly id: string;
  readonly aeadKey: Uint8Array;
  readonly legacyKey: Uint8Array;
}

interface ResolvedKeys {
  readonly primary: EncryptionKey | null;
  readonly ordered: readonly EncryptionKey[];
  readonly byId: ReadonlyMap<string, EncryptionKey>;
}

interface Keyring {
  readonly configured: boolean;
  readonly encryptOnWrite: boolean;
  readonly resolve: () => ResolvedKeys;
}

interface KeyringOptions {
  primaryKey?: string;
  decryptOnlyKeys?: string;
  encryptOnWrite?: boolean;
}

class KeyringConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyringConfigurationError";
  }
}

const decodeKey = (encodedKey: string): Uint8Array | null => {
  try {
    return decodeBase64(encodedKey);
  } catch {
    return null;
  }
};

const deriveEncryptionKey = (encodedKey: string): EncryptionKey => {
  const legacyKey = decodeKey(encodedKey);
  if (legacyKey?.length !== secretbox.keyLength) {
    throw new KeyringConfigurationError(
      `Encryption key must be ${secretbox.keyLength} bytes (base64 encoded)`,
    );
  }

  return {
    aeadKey: new Uint8Array(hkdfSync("sha256", legacyKey, NO_SALT, AEAD_KEY_INFO, AEAD_KEY_BYTES)),
    id: Buffer.from(hkdfSync("sha256", legacyKey, NO_SALT, KEY_ID_INFO, KEY_ID_BYTES)).toString("hex"),
    legacyKey,
  };
};

const splitKeyList = (keys: string | undefined): string[] => {
  if (!keys) {
    return [];
  }
  return keys
    .split(KEY_LIST_SEPARATOR)
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
};

const resolveKeys = (options: KeyringOptions): ResolvedKeys => {
  const primaryKey = options.primaryKey?.trim();
  const decryptOnlyKeys = splitKeyList(options.decryptOnlyKeys);

  if (!primaryKey && decryptOnlyKeys.length > 0) {
    throw new KeyringConfigurationError(
      "ENCRYPTION_KEYS_DECRYPT_ONLY requires ENCRYPTION_KEY to be set",
    );
  }

  const ordered: EncryptionKey[] = [];
  const byId = new Map<string, EncryptionKey>();

  for (const encodedKey of [primaryKey, ...decryptOnlyKeys]) {
    if (!encodedKey) {
      continue;
    }
    const key = deriveEncryptionKey(encodedKey);
    if (byId.has(key.id)) {
      continue;
    }
    byId.set(key.id, key);
    ordered.push(key);
  }

  return { byId, ordered, primary: ordered[0] ?? null };
};

const isUsableKey = (encodedKey: string | undefined): boolean => {
  const trimmedKey = encodedKey?.trim();
  if (!trimmedKey) {
    return false;
  }
  return decodeKey(trimmedKey)?.length === secretbox.keyLength;
};

const createKeyring = (options: KeyringOptions = {}): Keyring => {
  const encryptOnWrite = options.encryptOnWrite ?? isUsableKey(options.primaryKey);
  let resolved: ResolvedKeys | null = null;

  const resolve = (): ResolvedKeys => {
    resolved ??= resolveKeys(options);
    return resolved;
  };

  if (encryptOnWrite && !resolve().primary) {
    throw new KeyringConfigurationError(
      "Encrypting credentials on write requires ENCRYPTION_KEY to be set",
    );
  }

  return { configured: Boolean(options.primaryKey?.trim()), encryptOnWrite, resolve };
};

const hasEncryptionKey = (keyring: Keyring): boolean => keyring.configured;

export { KeyringConfigurationError, createKeyring, hasEncryptionKey };
export type { EncryptionKey, Keyring, KeyringOptions };
