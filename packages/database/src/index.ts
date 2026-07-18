export { createDatabase, closeDatabase } from "./utils/database";
export { classifyDatabaseError, getDatabaseErrorDetails } from "./utils/errors";
export type { DatabaseErrorClassification, DatabaseErrorDetails } from "./utils/errors";
export { account, user } from "./database/auth-schema";
export { encryptPassword, decryptPassword } from "./encryption";
