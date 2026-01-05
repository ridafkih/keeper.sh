import { randomBytes, secretbox } from "tweetnacl";
import { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } from "tweetnacl-util";

const parseKey = (key: string): Uint8Array => {
  const decoded = decodeBase64(key);
  if (decoded.length !== secretbox.keyLength) {
    throw new Error(`Encryption key must be ${secretbox.keyLength} bytes (base64 encoded)`);
  }
  return decoded;
};

const encryptPassword = (password: string, key: string): string => {
  const keyBytes = parseKey(key);
  const nonce = randomBytes(secretbox.nonceLength);
  const encrypted = secretbox(decodeUTF8(password), nonce, keyBytes);
  return `${encodeBase64(nonce)}:${encodeBase64(encrypted)}`;
};

const decryptPassword = (encryptedData: string, key: string): string => {
  const keyBytes = parseKey(key);
  const [nonceB64, encryptedB64] = encryptedData.split(":");

  if (!nonceB64 || !encryptedB64) {
    throw new Error("Invalid encrypted data format");
  }

  const nonce = decodeBase64(nonceB64);
  const encrypted = decodeBase64(encryptedB64);
  const decrypted = secretbox.open(encrypted, nonce, keyBytes);

  if (!decrypted) {
    throw new Error("Decryption failed");
  }

  return encodeUTF8(decrypted);
};

export { encryptPassword, decryptPassword };
