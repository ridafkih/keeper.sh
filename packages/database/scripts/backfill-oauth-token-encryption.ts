import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import {
  backfillOAuthTokenEncryption,
  countUnencryptedOAuthTokens,
  createOAuthTokenBackfillDatabase,
} from "../src/database/backfill-oauth-token-encryption";

const DEFAULT_BATCH_SIZE = 200;
const RADIX = 10;
const VERIFICATION_FAILED_EXIT_CODE = 1;

const report = (payload: Record<string, unknown>): Promise<number> =>
  Bun.write(Bun.stdout, `${JSON.stringify(payload)}\n`);

const connectionString = Bun.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing");
}

const encryptionKey = Bun.env.ENCRYPTION_KEY;

if (!encryptionKey) {
  throw new Error("ENCRYPTION_KEY is missing");
}

const argv = Bun.argv.slice(2);
const args = new Set(argv);
const dryRun = args.has("--dry-run");
const verifyOnly = args.has("--verify");

const resolveBatchSize = (): number => {
  const batchSizeArg = argv.find((argument) => argument.startsWith("--batch-size="));
  if (!batchSizeArg) {
    return DEFAULT_BATCH_SIZE;
  }
  return Number.parseInt(batchSizeArg.split("=")[1] ?? "", RADIX);
};

const batchSize = resolveBatchSize();

if (!Number.isInteger(batchSize) || batchSize <= 0) {
  throw new Error("--batch-size must be a positive integer");
}

const resolveMode = (): string => {
  if (dryRun) {
    return "dry-run";
  }
  return "backfill";
};

const connection = new Client({ connectionString });
const database = drizzle(connection);
await connection.connect();

try {
  const backfillDatabase = createOAuthTokenBackfillDatabase(database);

  if (verifyOnly) {
    const remaining = await countUnencryptedOAuthTokens(backfillDatabase);
    await report({ mode: "verify", remaining });
    if (remaining > 0) {
      process.exitCode = VERIFICATION_FAILED_EXIT_CODE;
    }
  } else {
    const result = await backfillOAuthTokenEncryption(backfillDatabase, encryptionKey, {
      batchSize,
      dryRun,
    });
    await report({ mode: resolveMode(), ...result });
  }
} finally {
  await connection.end();
}
