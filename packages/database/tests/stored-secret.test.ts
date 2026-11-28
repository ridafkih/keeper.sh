import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { KeyringConfigurationError, createKeyring, hasEncryptionKey } from "../src/keyring";
import {
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
} from "../src/stored-secret";
import type { SecretDecryptionReason } from "../src/stored-secret";

const LEGACY_FIXTURE_KEY = "a2VlcGVyLWxlZ2FjeS1maXh0dXJlLWtleS0wMDAwMDE=";
const LEGACY_FIXTURE_CIPHERTEXT
  = "eJQFzVBwgqJL3ot1GJ/whFngmXq2PQJ8:JoExn5GhCtkIwDDjVdWUNDVZLigre6PaXQKa26XqrJ0AAQs=";
const LEGACY_FIXTURE_PLAINTEXT = "caldav-app-password";

const KNOWN_ANSWER_KEY_ID = "6b006afab1f58197";
const KNOWN_ANSWER_AEAD_KEY_HEX
  = "fb80fb8201d56a6ffb0267580071602d6618f1a4406ebb0d205151904f5352f5";
const KNOWN_ANSWERS = [
  {
    plaintext: "ya29.known-answer-access-token",
    purpose: "oauth_credentials.accessToken",
    stored: "enc:v1:6b006afab1f58197:AAECAwQFBgcICQoL:aZ9bt1HXcg73XRWqwip3i6MjHucjI3YBbN_N90wk-L2yU1KfobvZQ-gQDJexlg",
  },
  {
    plaintext: "1//known-answer-refresh-token",
    purpose: "oauth_credentials.refreshToken",
    stored: "enc:v1:6b006afab1f58197:ICEiIyQlJicoKSor:3EKOFYgpb5QHyjvDnQepMFaGuKzJXsWyBIMGkiziZS-2XbrEiQwuTLQCkk2H",
  },
  {
    plaintext: "pässwörd-日本語-🔑",
    purpose: "caldav_credentials.encryptedPassword",
    stored: "enc:v1:6b006afab1f58197:QEFCQ0RFRkdISUpL:J25ZpPzRHhgEM3v5r3To-xl2w5uSQRFha6_Zvcx2hMPK967gr_BbFuE",
  },
] as const;

const ROW_ID = "6f1f2a0e-58d6-4b53-9a1f-0c5d3f7a9b10";
const OTHER_ROW_ID = "0b0d8b6e-3a55-4f5e-8f0a-7f6f0f2d1c22";
const ACCESS_TOKEN = "ya29.a0AfH6SMBexampleAccessToken";

const generateKey = (): string => randomBytes(32).toString("base64");

const encryptingKeyring = (primaryKey: string, decryptOnlyKeys?: string) =>
  createKeyring({ decryptOnlyKeys, encryptOnWrite: true, primaryKey });

const readFailureReason = (run: () => unknown): SecretDecryptionReason | null => {
  try {
    run();
  } catch (error) {
    if (error instanceof SecretDecryptionError) {
      return error.reason;
    }
    throw error;
  }
  return null;
};

const flipCharacter = (value: string, index: number): string => {
  const flipped = value.charAt(index) === "A" && "B";
  return `${value.slice(0, index)}${flipped || "A"}${value.slice(index + 1)}`;
};

describe("versioned secret format", () => {
  it("round-trips a value through the versioned format", () => {
    const keyring = encryptingKeyring(generateKey());
    const sealed = sealSecret("oauth_credentials.accessToken", ACCESS_TOKEN, keyring, ROW_ID);

    expect(storedSecretValue(sealed).startsWith(ENCRYPTED_SECRET_MARKER)).toBe(true);
    expect(storedSecretValue(sealed)).not.toContain(ACCESS_TOKEN);
    expect(isSecretVersioned(sealed)).toBe(true);
    expect(openSecret(sealed, keyring, ROW_ID)).toBe(ACCESS_TOKEN);
  });

  it("carries the identifier of the key that sealed the value", () => {
    const keyring = encryptingKeyring(generateKey());
    const sealed = sealSecret("oauth_credentials.accessToken", ACCESS_TOKEN, keyring, ROW_ID);
    const [namespace, version, keyId, nonce, body] = storedSecretValue(sealed).split(":");

    expect([namespace, version]).toEqual(["enc", "v1"]);
    expect(keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(keyId).toBe(keyring.resolve().primary?.id);
    expect(readSecretKeyId(sealed)).toBe(keyId);
    expect(Buffer.from(nonce ?? "", "base64url")).toHaveLength(12);
    expect(Buffer.from(body ?? "", "base64url").length).toBe(ACCESS_TOKEN.length + 16);
  });

  it("derives the same key identifier for the same key on every construction", () => {
    const key = generateKey();

    expect(createKeyring({ primaryKey: key }).resolve().primary?.id)
      .toBe(createKeyring({ primaryKey: key }).resolve().primary?.id);
    expect(createKeyring({ primaryKey: key }).resolve().primary?.id)
      .not.toBe(createKeyring({ primaryKey: generateKey() }).resolve().primary?.id);
  });

  it("never exposes key material through the key identifier", () => {
    const key = generateKey();
    const resolved = createKeyring({ primaryKey: key }).resolve().primary;
    const rawKeyHex = Buffer.from(key, "base64").toString("hex");

    expect(rawKeyHex).not.toContain(resolved?.id ?? "");
    expect(Buffer.from(resolved?.aeadKey ?? []).toString("hex")).not.toBe(rawKeyHex);
  });

  it("uses a fresh nonce for every sealed value", () => {
    const keyring = encryptingKeyring(generateKey());
    const nonces = new Set<string>();
    for (let index = 0; index < 500; index++) {
      const sealed = sealSecret("oauth_credentials.accessToken", ACCESS_TOKEN, keyring, ROW_ID);
      nonces.add(storedSecretValue(sealed).split(":")[3] ?? "");
    }

    expect(nonces.size).toBe(500);
  });

  it("round-trips empty, long and non-ASCII values", () => {
    const keyring = encryptingKeyring(generateKey());
    for (const value of ["", "x".repeat(8192), "pässwörd-日本語-🔑"]) {
      const sealed = sealSecret("caldav_credentials.encryptedPassword", value, keyring, ROW_ID);
      expect(openSecret(sealed, keyring, ROW_ID)).toBe(value);
    }
  });
});

describe("known answers", () => {
  it("derives the recorded key identifier and cipher key from a fixed key", () => {
    const key = createKeyring({ primaryKey: LEGACY_FIXTURE_KEY }).resolve().primary;

    expect(key?.id).toBe(KNOWN_ANSWER_KEY_ID);
    expect(Buffer.from(key?.aeadKey ?? []).toString("hex")).toBe(KNOWN_ANSWER_AEAD_KEY_HEX);
  });

  it("opens values sealed by an independent implementation of the format", () => {
    const keyring = createKeyring({ primaryKey: LEGACY_FIXTURE_KEY });

    for (const { plaintext, purpose, stored } of KNOWN_ANSWERS) {
      expect(openSecret(readStoredSecret(purpose, stored), keyring, ROW_ID)).toBe(plaintext);
    }
  });

  it("agrees with the runtime's WebCrypto implementation in both directions", async () => {
    const keyring = encryptingKeyring(LEGACY_FIXTURE_KEY);
    const subtleKey = await crypto.subtle.importKey(
      "raw",
      Buffer.from(KNOWN_ANSWER_AEAD_KEY_HEX, "hex"),
      "AES-GCM",
      false,
      ["decrypt", "encrypt"],
    );
    const associatedData = (purpose: string): Uint8Array<ArrayBuffer> =>
      new Uint8Array(
        Buffer.from(JSON.stringify(["v1", KNOWN_ANSWER_KEY_ID, purpose, ROW_ID]), "utf8"),
      );

    for (const { plaintext, purpose } of KNOWN_ANSWERS) {
      const sealed = storedSecretValue(sealSecret(purpose, plaintext, keyring, ROW_ID));
      const [nonce, body] = sealed.split(":").slice(3);
      const opened = await crypto.subtle.decrypt(
        {
          additionalData: associatedData(purpose),
          iv: Buffer.from(nonce ?? "", "base64url"),
          name: "AES-GCM",
          tagLength: 128,
        },
        subtleKey,
        Buffer.from(body ?? "", "base64url"),
      );
      expect(new TextDecoder().decode(opened)).toBe(plaintext);

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealedBySubtle = await crypto.subtle.encrypt(
        { additionalData: associatedData(purpose), iv, name: "AES-GCM", tagLength: 128 },
        subtleKey,
        new TextEncoder().encode(plaintext),
      );
      const stored = [
        "enc",
        "v1",
        KNOWN_ANSWER_KEY_ID,
        Buffer.from(iv).toString("base64url"),
        Buffer.from(sealedBySubtle).toString("base64url"),
      ].join(":");
      expect(openSecret(readStoredSecret(purpose, stored), keyring, ROW_ID)).toBe(plaintext);
    }
  });

  it("derives the recorded keys through the runtime's WebCrypto HKDF", async () => {
    const material = await crypto.subtle.importKey(
      "raw",
      Buffer.from(LEGACY_FIXTURE_KEY, "base64"),
      "HKDF",
      false,
      ["deriveBits"],
    );
    const derive = async (info: string, bytes: number): Promise<string> =>
      Buffer.from(await crypto.subtle.deriveBits(
        {
          hash: "SHA-256",
          info: new TextEncoder().encode(info),
          name: "HKDF",
          salt: new Uint8Array(0),
        },
        material,
        bytes * 8,
      )).toString("hex");

    expect(await derive("keeper.sh/credential-encryption/v1/aes-256-gcm", 32))
      .toBe(KNOWN_ANSWER_AEAD_KEY_HEX);
    expect(await derive("keeper.sh/credential-encryption/key-id", 8)).toBe(KNOWN_ANSWER_KEY_ID);
  });
});

describe("row binding", () => {
  it("refuses a value that was moved to another row", () => {
    const keyring = encryptingKeyring(generateKey());
    const sealed = sealSecret("oauth_credentials.refreshToken", "1//refresh", keyring, ROW_ID);

    expect(readFailureReason(() => openSecret(sealed, keyring, OTHER_ROW_ID))).toBe("unreadable");
  });

  it("refuses a value that was moved to another column", () => {
    const keyring = encryptingKeyring(generateKey());
    const sealed = sealSecret("oauth_credentials.accessToken", ACCESS_TOKEN, keyring, ROW_ID);
    const moved = readStoredSecret("oauth_credentials.refreshToken", storedSecretValue(sealed));

    expect(readFailureReason(() => openSecret(moved, keyring, ROW_ID))).toBe("unreadable");
  });

  it("treats row identifiers case-insensitively", () => {
    const keyring = encryptingKeyring(generateKey());
    const sealed = sealSecret("oauth_credentials.accessToken", ACCESS_TOKEN, keyring, ROW_ID);

    expect(openSecret(sealed, keyring, ROW_ID.toUpperCase())).toBe(ACCESS_TOKEN);
  });
});

describe("tampering and malformed values", () => {
  it("refuses a value whose ciphertext was altered", () => {
    const keyring = encryptingKeyring(generateKey());
    const sealed = storedSecretValue(
      sealSecret("oauth_credentials.accessToken", ACCESS_TOKEN, keyring, ROW_ID),
    );
    const bodyStart = sealed.lastIndexOf(":") + 1;
    for (const index of [bodyStart, bodyStart + 10, sealed.length - 2]) {
      const tampered = readStoredSecret(
        "oauth_credentials.accessToken",
        flipCharacter(sealed, index),
      );
      expect(readFailureReason(() => openSecret(tampered, keyring, ROW_ID))).toBe("unreadable");
    }
  });

  it("refuses a value whose nonce was altered", () => {
    const keyring = encryptingKeyring(generateKey());
    const sealed = storedSecretValue(
      sealSecret("oauth_credentials.accessToken", ACCESS_TOKEN, keyring, ROW_ID),
    );
    const fields = sealed.split(":");
    fields[3] = flipCharacter(fields[3] ?? "", 0);
    const tampered = readStoredSecret("oauth_credentials.accessToken", fields.join(":"));

    expect(readFailureReason(() => openSecret(tampered, keyring, ROW_ID))).toBe("unreadable");
  });

  it("refuses a truncated authentication tag", () => {
    const keyring = encryptingKeyring(generateKey());
    const sealed = storedSecretValue(
      sealSecret("oauth_credentials.accessToken", "", keyring, ROW_ID),
    );
    const fields = sealed.split(":");
    const body = Buffer.from(fields[4] ?? "", "base64url");
    fields[4] = body.subarray(0, 8).toString("base64url");
    const truncated = readStoredSecret("oauth_credentials.accessToken", fields.join(":"));

    expect(readFailureReason(() => openSecret(truncated, keyring, ROW_ID))).toBe("malformed");
  });

  it("refuses malformed versioned values without attempting decryption", () => {
    const keyring = encryptingKeyring(generateKey());
    const keyId = keyring.resolve().primary?.id ?? "";
    const malformed = [
      `enc:v1:${keyId}:AAAAAAAAAAAAAAAA`,
      `enc:v1:${keyId}:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAA:extra`,
      `enc:v1:NOT-A-KEY-ID:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
      `enc:v1:${keyId}:AAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
      `enc:v1:${keyId}:AAAAAAAAAAAAAAA+:AAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
      `enc:v1:${keyId}:AAAAAAAAAAAAAAAA:AAAA/AAAAAAAAAAAAAAAAAAAAAAA`,
    ];
    for (const value of malformed) {
      const secret = readStoredSecret("oauth_credentials.accessToken", value);
      expect(readFailureReason(() => openSecret(secret, keyring, ROW_ID))).toBe("malformed");
    }
  });

  it("refuses a format version it does not know", () => {
    const keyring = encryptingKeyring(generateKey());
    const secret = readStoredSecret("oauth_credentials.accessToken", "enc:v2:anything");

    expect(readFailureReason(() => openSecret(secret, keyring, ROW_ID)))
      .toBe("unsupported-version");
  });
});

describe("keyring", () => {
  it("reports a value sealed under an unconfigured key as a missing key", () => {
    const sealed = sealSecret(
      "oauth_credentials.accessToken",
      ACCESS_TOKEN,
      encryptingKeyring(generateKey()),
      ROW_ID,
    );

    expect(readFailureReason(() => openSecret(sealed, createKeyring({ primaryKey: generateKey() }), ROW_ID)))
      .toBe("missing-key");
    expect(readFailureReason(() => openSecret(sealed, createKeyring(), ROW_ID))).toBe("missing-key");
  });

  it("reads values sealed under a decrypt-only key and writes under the primary key", () => {
    const oldKey = generateKey();
    const newKey = generateKey();
    const sealedUnderOld = sealSecret(
      "oauth_credentials.accessToken",
      ACCESS_TOKEN,
      encryptingKeyring(oldKey),
      ROW_ID,
    );
    const rotated = encryptingKeyring(newKey, oldKey);

    expect(openSecret(sealedUnderOld, rotated, ROW_ID)).toBe(ACCESS_TOKEN);

    const sealedUnderNew = sealSecret("oauth_credentials.accessToken", ACCESS_TOKEN, rotated, ROW_ID);
    expect(readSecretKeyId(sealedUnderNew)).toBe(rotated.resolve().primary?.id);
    expect(readSecretKeyId(sealedUnderNew)).not.toBe(readSecretKeyId(sealedUnderOld));
    expect(openSecret(sealedUnderNew, encryptingKeyring(oldKey, newKey), ROW_ID)).toBe(ACCESS_TOKEN);
  });

  it("accepts several decrypt-only keys and ignores blanks and duplicates", () => {
    const primary = generateKey();
    const first = generateKey();
    const second = generateKey();
    const keyring = createKeyring({
      decryptOnlyKeys: ` ${first}, ,${second},${primary},${first}`,
      primaryKey: primary,
    });

    expect(keyring.resolve().ordered).toHaveLength(3);
    expect(keyring.resolve().primary?.id).toBe(createKeyring({ primaryKey: primary }).resolve().primary?.id);
  });

  it("is usable without any key and reports that none is configured", () => {
    const keyring = createKeyring();

    expect(hasEncryptionKey(keyring)).toBe(false);
    expect(keyring.resolve().primary).toBeNull();
    expect(hasEncryptionKey(createKeyring({ primaryKey: "  " }))).toBe(false);
  });

  it("defers validating a malformed key until it is needed", () => {
    const keyring = createKeyring({ primaryKey: "not-a-32-byte-key" });

    expect(hasEncryptionKey(keyring)).toBe(true);
    expect(() => keyring.resolve()).toThrow(/32 bytes/);
    const stored = readStoredSecret("oauth_credentials.accessToken", ACCESS_TOKEN);
    expect(openSecret(stored, keyring, ROW_ID)).toBe(ACCESS_TOKEN);
  });

  it("refuses decrypt-only keys without a primary key", () => {
    expect(() => createKeyring({ decryptOnlyKeys: generateKey() }).resolve())
      .toThrow(KeyringConfigurationError);
  });

  it("refuses to encrypt on write without a usable primary key", () => {
    expect(() => createKeyring({ encryptOnWrite: true })).toThrow(KeyringConfigurationError);
    expect(() => createKeyring({ encryptOnWrite: true, primaryKey: "short" })).toThrow();
  });
});

describe("values stored before the versioned format", () => {
  it("returns a plaintext token unchanged, with or without a key", () => {
    const stored = readStoredSecret("oauth_credentials.accessToken", ACCESS_TOKEN);

    expect(isSecretVersioned(stored)).toBe(false);
    expect(openSecret(stored, createKeyring(), ROW_ID)).toBe(ACCESS_TOKEN);
    expect(openSecret(stored, createKeyring({ primaryKey: generateKey() }), ROW_ID)).toBe(ACCESS_TOKEN);
  });

  it("reads a password sealed by the original two-part format", () => {
    const stored = readStoredSecret("caldav_credentials.encryptedPassword", LEGACY_FIXTURE_CIPHERTEXT);

    expect(openSecret(stored, createKeyring({ primaryKey: LEGACY_FIXTURE_KEY }), ROW_ID))
      .toBe(LEGACY_FIXTURE_PLAINTEXT);
    expect(openSecret(stored, createKeyring({ primaryKey: LEGACY_FIXTURE_KEY }), OTHER_ROW_ID))
      .toBe(LEGACY_FIXTURE_PLAINTEXT);
  });

  it("reads a two-part password with a decrypt-only key after the primary key changed", () => {
    const stored = readStoredSecret("caldav_credentials.encryptedPassword", LEGACY_FIXTURE_CIPHERTEXT);
    const keyring = createKeyring({ decryptOnlyKeys: LEGACY_FIXTURE_KEY, primaryKey: generateKey() });

    expect(openSecret(stored, keyring, ROW_ID)).toBe(LEGACY_FIXTURE_PLAINTEXT);
  });

  it("reports a two-part password it cannot read instead of returning it", () => {
    const stored = readStoredSecret("caldav_credentials.encryptedPassword", LEGACY_FIXTURE_CIPHERTEXT);

    expect(readFailureReason(() => openSecret(stored, createKeyring({ primaryKey: generateKey() }), ROW_ID)))
      .toBe("unreadable");
    expect(readFailureReason(() => openSecret(stored, createKeyring(), ROW_ID))).toBe("missing-key");
  });

  it("never treats a password column value as plaintext", () => {
    const stored = readStoredSecret("caldav_credentials.encryptedPassword", "hunter2");

    expect(readFailureReason(() => openSecret(stored, createKeyring({ primaryKey: generateKey() }), ROW_ID)))
      .toBe("malformed");
  });
});

describe("writing before encryption on write is enabled", () => {
  it("stores tokens exactly as given", () => {
    const keyring = createKeyring({ primaryKey: generateKey() });
    const stored = sealSecret("oauth_credentials.accessToken", ACCESS_TOKEN, keyring, ROW_ID);

    expect(storedSecretValue(stored)).toBe(ACCESS_TOKEN);
    expect(storedSecretValue(sealSecret("oauth_credentials.refreshToken", "1//r", createKeyring(), ROW_ID)))
      .toBe("1//r");
  });

  it("stores passwords in the original two-part format", () => {
    const keyring = createKeyring({ primaryKey: generateKey() });
    const stored = sealSecret("caldav_credentials.encryptedPassword", "hunter2", keyring, ROW_ID);

    expect(isSecretVersioned(stored)).toBe(false);
    expect(storedSecretValue(stored).split(":")).toHaveLength(2);
    expect(storedSecretValue(stored)).not.toContain("hunter2");
    expect(openSecret(stored, keyring, OTHER_ROW_ID)).toBe("hunter2");
  });

  it("refuses to store a password without a key", () => {
    expect(() => sealSecret("caldav_credentials.encryptedPassword", "hunter2", createKeyring(), ROW_ID))
      .toThrow(SecretEncryptionError);
  });

  it("refuses to store a token that would be mistaken for an encrypted value", () => {
    expect(() => sealSecret("oauth_credentials.accessToken", "enc:v1:forged", createKeyring(), ROW_ID))
      .toThrow(SecretEncryptionError);
  });
});

describe("explicit encryption", () => {
  it("encrypts regardless of the write setting", () => {
    const keyring = createKeyring({ primaryKey: generateKey() });
    const sealed = encryptSecret("oauth_credentials.accessToken", ACCESS_TOKEN, keyring, ROW_ID);

    expect(isSecretVersioned(sealed)).toBe(true);
    expect(openSecret(sealed, keyring, ROW_ID)).toBe(ACCESS_TOKEN);
  });

  it("requires a key", () => {
    expect(() => encryptSecret("oauth_credentials.accessToken", ACCESS_TOKEN, createKeyring(), ROW_ID))
      .toThrow(SecretEncryptionError);
  });
});

describe("stored secret handling", () => {
  it("does not reveal its value when serialised, interpolated or inspected", () => {
    const stored = readStoredSecret("oauth_credentials.accessToken", ACCESS_TOKEN);

    expect(JSON.stringify(stored)).toBe('"[stored secret]"');
    expect(JSON.stringify({ stored })).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify([stored])).not.toContain(ACCESS_TOKEN);
    expect(`${String(stored)}`).not.toContain(ACCESS_TOKEN);
    expect(Bun.inspect({ stored })).not.toContain(ACCESS_TOKEN);
  });

  it("treats an empty stored value as absent", () => {
    const empty = readStoredSecret("oauth_credentials.accessToken", "");
    const present = readStoredSecret("oauth_credentials.accessToken", ACCESS_TOKEN);

    expect(Boolean(empty)).toBe(true);
    expect(hasStoredSecret(empty)).toBe(false);
    expect(hasStoredSecret(present)).toBe(true);
    expect(hasStoredSecret(null)).toBe(false);
    expect(hasStoredSecret()).toBe(false);
  });

  it("does not put secret material in error messages", () => {
    const key = generateKey();
    const keyring = encryptingKeyring(key);
    const sealed = sealSecret("oauth_credentials.accessToken", ACCESS_TOKEN, keyring, ROW_ID);

    try {
      openSecret(sealed, keyring, OTHER_ROW_ID);
      throw new Error("expected the read to fail");
    } catch (error) {
      const text = `${String(error)} ${JSON.stringify(error)}`;
      expect(text).not.toContain(ACCESS_TOKEN);
      expect(text).not.toContain(key);
      expect(text).not.toContain(storedSecretValue(sealed));
    }
  });
});
