export { createDatabase, closeDatabase } from "./utils/database";
export { classifyDatabaseError, getDatabaseErrorDetails } from "./utils/errors";
export type { DatabaseErrorClassification, DatabaseErrorDetails } from "./utils/errors";
export { account, user } from "./database/auth-schema";
export { encryptPassword, decryptPassword } from "./encryption";
export { checkEncryptionKeyConfigured } from "./encryption-key-check";
export {
  ENCRYPTED_TOKEN_MARKER,
  TokenDecryptionError,
  TokenEncryptionError,
  decryptToken,
  encryptToken,
  isTokenEncrypted,
  readStoredToken,
  storedTokenValue,
} from "./token-encryption";
export type { StoredToken, TokenDecryptionReason } from "./token-encryption";
