export { createDatabase, closeDatabase } from "./utils/database";
export { classifyDatabaseError } from "./utils/errors";
export type { DatabaseErrorClassification } from "./utils/errors";
export { account, user } from "./database/auth-schema";
export { encryptPassword, decryptPassword } from "./encryption";
