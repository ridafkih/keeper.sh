import { describe, expect, it } from "vitest";
import {
  TokenDecryptionError,
  TokenEncryptionError,
  decryptToken,
  encryptToken,
  isTokenEncrypted,
  readStoredToken,
  storedTokenValue,
} from "../src/token-encryption";

const KEY = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
const OTHER_KEY = Buffer.from(new Uint8Array(32).fill(9)).toString("base64");

const NO_KEY: string | undefined = process.env.ENCRYPTION_KEY_DELIBERATELY_UNSET;

const ACCESS_TOKEN = "ya29.a0AfB_byC-not-a-real-google-access-token";
const REFRESH_TOKEN = "1//0gnot-a-real-refresh-token_with.symbols";

describe("token encryption round trip", () => {
  it("returns the exact original token after encrypt then decrypt", () => {
    const encrypted = encryptToken(ACCESS_TOKEN, KEY);

    expect(decryptToken(encrypted, KEY)).toBe(ACCESS_TOKEN);
  });

  it("round trips refresh tokens containing separator characters", () => {
    const encrypted = encryptToken(REFRESH_TOKEN, KEY);

    expect(decryptToken(encrypted, KEY)).toBe(REFRESH_TOKEN);
  });

  it("round trips unicode payloads byte for byte", () => {
    const token = "tökén-üñïçødé-🔐";
    const encrypted = encryptToken(token, KEY);

    expect(decryptToken(encrypted, KEY)).toBe(token);
  });

  it("produces a distinct ciphertext per call and both decrypt to the same token", () => {
    const first = encryptToken(ACCESS_TOKEN, KEY);
    const second = encryptToken(ACCESS_TOKEN, KEY);

    expect(storedTokenValue(first)).not.toBe(storedTokenValue(second));
    expect(decryptToken(first, KEY)).toBe(ACCESS_TOKEN);
    expect(decryptToken(second, KEY)).toBe(ACCESS_TOKEN);
  });

  it("marks the ciphertext with an explicit versioned prefix", () => {
    const encrypted = encryptToken(ACCESS_TOKEN, KEY);

    expect(storedTokenValue(encrypted).startsWith("enc:v1:")).toBe(true);
    expect(isTokenEncrypted(encrypted)).toBe(true);
  });
});

describe("dual read of unmigrated values", () => {
  it("reads a plaintext value back unchanged without a key", () => {
    const stored = readStoredToken(ACCESS_TOKEN);

    expect(isTokenEncrypted(stored)).toBe(false);
    expect(decryptToken(stored, NO_KEY)).toBe(ACCESS_TOKEN);
  });

  it("reads a plaintext value back unchanged when a key is configured", () => {
    const stored = readStoredToken(REFRESH_TOKEN);

    expect(decryptToken(stored, KEY)).toBe(REFRESH_TOKEN);
  });

  it("reads an encrypted value back through the stored representation", () => {
    const written = storedTokenValue(encryptToken(ACCESS_TOKEN, KEY));
    const reread = readStoredToken(written);

    expect(isTokenEncrypted(reread)).toBe(true);
    expect(decryptToken(reread, KEY)).toBe(ACCESS_TOKEN);
  });

  it("does not treat a plaintext token that merely contains colons as encrypted", () => {
    const stored = readStoredToken("abc:def:ghi");

    expect(isTokenEncrypted(stored)).toBe(false);
    expect(decryptToken(stored, KEY)).toBe("abc:def:ghi");
  });
});

describe("loud, identifiable read failures", () => {
  it("throws instead of returning a value when the key is wrong", () => {
    const encrypted = readStoredToken(storedTokenValue(encryptToken(ACCESS_TOKEN, KEY)));

    expect(() => decryptToken(encrypted, OTHER_KEY)).toThrow(TokenDecryptionError);
  });

  it("reports a wrong key as unreadable and reauthentication worthy", () => {
    const encrypted = readStoredToken(storedTokenValue(encryptToken(ACCESS_TOKEN, KEY)));

    try {
      decryptToken(encrypted, OTHER_KEY);
      expect.unreachable("decryptToken must throw for a wrong key");
    } catch (error) {
      expect(error).toBeInstanceOf(TokenDecryptionError);
      expect((error as TokenDecryptionError).reason).toBe("unreadable");
      expect((error as TokenDecryptionError).requiresReauthentication).toBe(true);
    }
  });

  it("throws on truncated ciphertext rather than returning a partial token", () => {
    const written = storedTokenValue(encryptToken(ACCESS_TOKEN, KEY));
    const truncated = readStoredToken(written.slice(0, -8));

    expect(() => decryptToken(truncated, KEY)).toThrow(TokenDecryptionError);
  });

  it("throws when the nonce and ciphertext separator is missing", () => {
    const malformed = readStoredToken("enc:v1:onlyonesegment");

    expect(() => decryptToken(malformed, KEY)).toThrow(TokenDecryptionError);
  });

  it("throws on ciphertext whose bytes were tampered with", () => {
    const written = storedTokenValue(encryptToken(ACCESS_TOKEN, KEY));
    const [marker, version, nonce, ciphertext] = written.split(":");
    const body = ciphertext?.slice(0, -2) ?? "";
    const tampered = readStoredToken(`${marker}:${version}:${nonce}:${body}ZA==`);

    expect(() => decryptToken(tampered, KEY)).toThrow(TokenDecryptionError);
  });

  it("throws a configuration failure, not a reauthentication failure, when the key is absent", () => {
    const encrypted = readStoredToken(storedTokenValue(encryptToken(ACCESS_TOKEN, KEY)));

    try {
      decryptToken(encrypted, NO_KEY);
      expect.unreachable("decryptToken must throw when the key is missing");
    } catch (error) {
      expect(error).toBeInstanceOf(TokenDecryptionError);
      expect((error as TokenDecryptionError).reason).toBe("missing-key");
      expect((error as TokenDecryptionError).requiresReauthentication).toBe(false);
    }
  });

  it("refuses to read a future format instead of mistaking it for plaintext", () => {
    const future = readStoredToken("enc:v2:some-key-id:nonce:ciphertext");

    try {
      decryptToken(future, KEY);
      expect.unreachable("decryptToken must throw for an unknown format version");
    } catch (error) {
      expect(error).toBeInstanceOf(TokenDecryptionError);
      expect((error as TokenDecryptionError).reason).toBe("unsupported-version");
      expect((error as TokenDecryptionError).requiresReauthentication).toBe(false);
    }
  });

  it("never yields an empty string in place of a failure", () => {
    const cases = [
      "enc:v1:",
      "enc:v1::",
      "enc:v1:!!!:!!!",
      "enc:",
      "enc:v1:AAAA:AAAA",
    ];

    for (const value of cases) {
      expect(() => decryptToken(readStoredToken(value), KEY)).toThrow(TokenDecryptionError);
    }
  });
});

describe("loud write failures", () => {
  it("refuses to encrypt without a key", () => {
    expect(() => encryptToken(ACCESS_TOKEN, NO_KEY)).toThrow(TokenEncryptionError);
  });

  it("refuses to encrypt an empty token", () => {
    expect(() => encryptToken("", KEY)).toThrow(TokenEncryptionError);
  });

  it("refuses to encrypt an already encrypted value", () => {
    const written = storedTokenValue(encryptToken(ACCESS_TOKEN, KEY));

    expect(() => encryptToken(written, KEY)).toThrow(TokenEncryptionError);
  });

  it("refuses a key that is not the required length", () => {
    expect(() => encryptToken(ACCESS_TOKEN, "short")).toThrow(TokenEncryptionError);
  });
});
