export { createDatabase, closeDatabase, hasBoundedDatabaseCloseBegun } from "./utils/database";
export type { CloseDatabaseOptions } from "./utils/database";
export {
  classifyDatabaseError,
  getDatabaseErrorDetails,
  isDatabaseError,
  resolveDatabaseErrorClassification,
} from "./utils/errors";
export {
  instrumentDatabasePool,
  resetDatabasePoolTelemetry,
  withDatabasePoolWindow,
} from "./utils/pool-telemetry";
export type { DatabasePoolWindow, DatabasePoolWindowSample } from "./utils/pool-telemetry";
export type { DatabaseErrorClassification, DatabaseErrorDetails } from "./utils/errors";
export { account, user } from "./database/auth-schema";
export { encryptPassword, decryptPassword } from "./encryption";
export { buildImportedCalendarExists } from "./database/rediscovery-candidates";
export {
  createMigrationReadinessDatabase,
  waitForDatabaseMigrations,
} from "./database/migration-readiness";
