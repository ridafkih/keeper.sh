import { and, asc, eq, gt, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { caldavCredentialsTable, oauthCredentialsTable } from "./schema";
import { KeyringConfigurationError, createKeyring } from "../keyring";
import type { Keyring } from "../keyring";
import { isSqlState } from "../utils/errors";
import {
  ENCRYPTED_SECRET_MARKER,
  SecretDecryptionError,
  SecretEncryptionError,
  describeStoredSecret,
  encryptSecret,
  hasStoredSecret,
  openSecret,
} from "../stored-secret";
import type { SecretDecryptionReason, StoredSecret } from "../stored-secret";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_PASSES = 3;
const DEFAULT_TIME_BUDGET_MS = 300_000;
const FIRST_CURSOR = "00000000-0000-0000-0000-000000000000";
const MAX_CAUSE_DEPTH = 8;
const SQLSTATE_CLASS_LENGTH = 2;
const INFO_LEVEL = 30;
const WARN_LEVEL = 40;
const NO_KEY_REASON = "ENCRYPTION_KEY is not set";
const TIME_BUDGET_REASON = "time-budget";
const UNCLASSIFIED_FAILURE_REASON = "unclassified";
const SYSTEM_ERROR_CODE_PATTERN = /^E[A-Z0-9_]{2,47}$/;
const FAILURE_CODE_FIELDS = ["code", "errno"];
const SQLSTATE_REASONS: Record<string, string> = {
  "3D000": "database-not-found",
  "40001": "serialization-failure",
  "40P01": "deadlock-detected",
  "42501": "permission-denied",
  "42P01": "table-not-found",
  "55P03": "lock-timeout",
  "57014": "statement-cancelled",
};
const SQLSTATE_CLASS_REASONS: Record<string, string> = {
  "08": "connection-failed",
  "28": "authentication-failed",
  "53": "insufficient-resources",
  "57": "server-unavailable",
};
const ROW_SCOPED_SQLSTATES = new Set(["40001", "40P01", "55P03", "57014"]);

type CredentialTableName = "oauth_credentials" | "caldav_credentials";

interface CredentialSecretColumn {
  column: AnyPgColumn;
  name: string;
}

interface CredentialTarget {
  columns: CredentialSecretColumn[];
  id: AnyPgColumn;
  name: CredentialTableName;
  table: AnyPgTable;
}

interface StoredCredentialRow {
  id: string;
  secrets: Record<string, StoredSecret | null>;
}

interface CredentialSecretChange {
  name: string;
  next: StoredSecret;
  previous: StoredSecret;
}

interface CredentialBatchRequest {
  afterId: string;
  batchSize: number;
  currentKeyId: string;
}

interface CredentialEncryptionDatabase {
  readBatch: (
    target: CredentialTarget,
    request: CredentialBatchRequest,
  ) => Promise<StoredCredentialRow[]>;
  writeChanges: (
    target: CredentialTarget,
    id: string,
    changes: CredentialSecretChange[],
  ) => Promise<boolean>;
}

interface CredentialEncryptionSettings {
  decryptOnlyKeys?: string;
  primaryKey?: string;
}

type CredentialEncryptionKeys =
  | { keyring: Keyring; skipReason: null }
  | { keyring: null; skipReason: string };

interface CredentialEncryptionOptions {
  batchSize?: number;
  maxPasses?: number;
  now?: () => number;
  timeBudgetMs?: number;
}

type CredentialStoreOperation = "read" | "write";

interface DatabaseFailure {
  reason: string;
  sqlState: string | null;
}

interface CredentialStoreFailure extends DatabaseFailure {
  operation: CredentialStoreOperation;
  table: CredentialTableName;
}

interface CredentialEncryptionStop {
  operation: CredentialStoreOperation | null;
  reason: string;
  sqlState: string | null;
  table: CredentialTableName | null;
}

type CredentialEncryptionStatus = "complete" | "incomplete" | "skipped";

interface CredentialEncryptionOutcome {
  decryptOnlyKeyIds: string[];
  passes: number;
  primaryKeyId: string | null;
  rowsContended: number;
  rowsFailed: Record<string, number>;
  rowsScanned: number;
  skipReason: string | null;
  status: CredentialEncryptionStatus;
  stopped: CredentialEncryptionStop | null;
  valuesConverted: number;
  valuesUnreadable: Partial<Record<SecretDecryptionReason, number>>;
}

interface CredentialEncryptionReport {
  "credential_encryption.decrypt_only_key_ids": string[];
  "credential_encryption.passes": number;
  "credential_encryption.primary_key_id": string | null;
  "credential_encryption.rows_contended": number;
  "credential_encryption.rows_failed": Record<string, number>;
  "credential_encryption.rows_scanned": number;
  "credential_encryption.skip_reason": string | null;
  "credential_encryption.status": CredentialEncryptionStatus;
  "credential_encryption.stopped": CredentialEncryptionStop | null;
  "credential_encryption.values_converted": number;
  "credential_encryption.values_unreadable": Partial<Record<SecretDecryptionReason, number>>;
  level: number;
  msg: string;
  time: string;
}

class CredentialStoreError extends Error {
  readonly failure: CredentialStoreFailure;

  constructor(failure: CredentialStoreFailure) {
    super(`Stored credentials ${failure.operation} failed: ${failure.reason}`);
    this.name = "CredentialStoreError";
    this.failure = failure;
  }
}

class CredentialEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialEncryptionError";
  }
}

const readFailureCodes = (error: unknown): string[] => {
  const codes: string[] = [];
  let link = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof link !== "object" || link === null) {
      break;
    }
    for (const field of FAILURE_CODE_FIELDS) {
      const value: unknown = Reflect.get(link, field);
      if (typeof value === "string") {
        codes.push(value);
      }
    }
    link = Reflect.get(link, "cause");
  }
  return codes;
};

const describeDatabaseFailure = (error: unknown): DatabaseFailure => {
  const codes = readFailureCodes(error);
  const sqlState = codes.find((code) => isSqlState(code)) ?? null;
  if (sqlState !== null) {
    return {
      reason: SQLSTATE_REASONS[sqlState]
        ?? SQLSTATE_CLASS_REASONS[sqlState.slice(0, SQLSTATE_CLASS_LENGTH)]
        ?? UNCLASSIFIED_FAILURE_REASON,
      sqlState,
    };
  }
  const systemCode = codes.find((code) => SYSTEM_ERROR_CODE_PATTERN.test(code));
  return { reason: systemCode ?? UNCLASSIFIED_FAILURE_REASON, sqlState: null };
};

const runStoreOperation = async <Result>(
  operation: CredentialStoreOperation,
  table: CredentialTableName,
  run: () => Promise<Result>,
): Promise<Result> => {
  const outcome = await Promise.resolve().then(run).then(
    (result) => ({ result }),
    (error: unknown) => ({
      failure: new CredentialStoreError({ ...describeDatabaseFailure(error), operation, table }),
    }),
  );
  if ("failure" in outcome) {
    throw outcome.failure;
  }
  return outcome.result;
};

const CREDENTIAL_TARGETS: CredentialTarget[] = [
  {
    columns: [
      { column: oauthCredentialsTable.accessToken, name: "accessToken" },
      { column: oauthCredentialsTable.refreshToken, name: "refreshToken" },
    ],
    id: oauthCredentialsTable.id,
    name: "oauth_credentials",
    table: oauthCredentialsTable,
  },
  {
    columns: [{ column: caldavCredentialsTable.encryptedPassword, name: "encryptedPassword" }],
    id: caldavCredentialsTable.id,
    name: "caldav_credentials",
    table: caldavCredentialsTable,
  },
];

const isOutsideCurrentKey = (column: AnyPgColumn, currentKeyId: string): SQL =>
  sql`${column} not like ${`${ENCRYPTED_SECRET_MARKER}${currentKeyId}:%`}`;

const isUnlockedRow = (target: CredentialTarget, id: string): SQL =>
  sql`${target.id} in (
    select ${target.id} from ${target.table}
    where ${target.id} = ${id}
    for update skip locked
  )`;

const createCredentialEncryptionDatabase = (
  database: NodePgDatabase,
): CredentialEncryptionDatabase => ({
  readBatch: async (target, { afterId, batchSize, currentKeyId }) => {
    const selection: Record<string, AnyPgColumn> = { id: target.id };
    for (const { column, name } of target.columns) {
      selection[name] = column;
    }

    const rows = await runStoreOperation("read", target.name, () =>
      database
        .select(selection)
        .from(target.table)
        .where(and(
          gt(target.id, afterId),
          or(...target.columns.map(({ column }) => isOutsideCurrentKey(column, currentKeyId))),
        ))
        .orderBy(asc(target.id))
        .limit(batchSize));

    return rows.map((row) => {
      const secrets: Record<string, StoredSecret | null> = {};
      for (const { name } of target.columns) {
        secrets[name] = (row[name] ?? null) as StoredSecret | null;
      }
      return { id: String(row.id), secrets };
    });
  },
  writeChanges: async (target, id, changes) => {
    const values: Record<string, StoredSecret> = {};
    const unchangedSinceRead = [eq(target.id, id), isUnlockedRow(target, id)];
    for (const change of changes) {
      const column = target.columns.find(({ name }) => name === change.name);
      if (!column) {
        throw new CredentialEncryptionError(
          `Unknown credential column ${target.name}.${change.name}`,
        );
      }
      values[change.name] = change.next;
      unchangedSinceRead.push(eq(column.column, change.previous));
    }

    const written = await runStoreOperation("write", target.name, () =>
      database
        .update(target.table)
        .set(values)
        .where(and(...unchangedSinceRead))
        .returning({ id: target.id }));

    return written.length > 0;
  },
});

const readPrimaryKeyProblem = (primaryKey: string): string | null => {
  try {
    createKeyring({ encryptOnWrite: false, primaryKey }).resolve();
    return null;
  } catch (error) {
    if (error instanceof KeyringConfigurationError) {
      return error.message;
    }
    throw error;
  }
};

const resolveCredentialEncryptionKeys = (
  settings: CredentialEncryptionSettings,
): CredentialEncryptionKeys => {
  const primaryKey = settings.primaryKey?.trim();
  if (!primaryKey) {
    createKeyring({ decryptOnlyKeys: settings.decryptOnlyKeys }).resolve();
    return { keyring: null, skipReason: NO_KEY_REASON };
  }

  const primaryKeyProblem = readPrimaryKeyProblem(primaryKey);
  if (primaryKeyProblem !== null) {
    return { keyring: null, skipReason: primaryKeyProblem };
  }

  return {
    keyring: createKeyring({ decryptOnlyKeys: settings.decryptOnlyKeys, primaryKey }),
    skipReason: null,
  };
};

interface RowPlan {
  changes: CredentialSecretChange[];
  unreadable: SecretDecryptionReason[];
}

const planCredentialChanges = (
  row: StoredCredentialRow,
  keyring: Keyring,
  currentKeyId: string,
): RowPlan => {
  const plan: RowPlan = { changes: [], unreadable: [] };

  for (const [name, previous] of Object.entries(row.secrets)) {
    if (!hasStoredSecret(previous)) {
      continue;
    }
    const { form, keyId } = describeStoredSecret(previous);
    if (form === "versioned" && keyId === currentKeyId) {
      continue;
    }

    try {
      const plaintext = openSecret(previous, keyring, row.id);
      const next = encryptSecret(previous.purpose, plaintext, keyring, row.id);
      if (openSecret(next, keyring, row.id) !== plaintext) {
        throw new CredentialEncryptionError(
          `Encrypted value for ${previous.purpose} on row ${row.id} did not read back`,
        );
      }
      plan.changes.push({ name, next, previous });
    } catch (error) {
      if (error instanceof SecretDecryptionError) {
        plan.unreadable.push(error.reason);
        continue;
      }
      if (error instanceof SecretEncryptionError) {
        plan.unreadable.push("malformed");
        continue;
      }
      throw error;
    }
  }

  return plan;
};

interface PassTally {
  rowsContended: number;
  rowsFailed: Record<string, number>;
  rowsScanned: number;
  valuesConverted: number;
  valuesUnreadable: Partial<Record<SecretDecryptionReason, number>>;
}

const emptyTally = (): PassTally => ({
  rowsContended: 0,
  rowsFailed: {},
  rowsScanned: 0,
  valuesConverted: 0,
  valuesUnreadable: {},
});

const skippedOutcome = (skipReason: string): CredentialEncryptionOutcome => ({
  decryptOnlyKeyIds: [],
  passes: 0,
  primaryKeyId: null,
  rowsContended: 0,
  rowsFailed: {},
  rowsScanned: 0,
  skipReason,
  status: "skipped",
  stopped: null,
  valuesConverted: 0,
  valuesUnreadable: {},
});

const encryptStoredCredentials = async (
  database: CredentialEncryptionDatabase,
  keys: CredentialEncryptionKeys,
  options: CredentialEncryptionOptions = {},
): Promise<CredentialEncryptionOutcome> => {
  if (keys.keyring === null) {
    return skippedOutcome(keys.skipReason);
  }

  const { keyring } = keys;
  const { ordered, primary } = keyring.resolve();
  if (!primary) {
    return skippedOutcome(NO_KEY_REASON);
  }

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxPasses = options.maxPasses ?? DEFAULT_MAX_PASSES;
  const now = options.now ?? (() => performance.now());
  const deadline = now() + (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);

  const outcome: CredentialEncryptionOutcome = {
    decryptOnlyKeyIds: ordered.filter(({ id }) => id !== primary.id).map(({ id }) => id),
    passes: 0,
    primaryKeyId: primary.id,
    rowsContended: 0,
    rowsFailed: {},
    rowsScanned: 0,
    skipReason: null,
    status: "complete",
    stopped: null,
    valuesConverted: 0,
    valuesUnreadable: {},
  };

  const writeRow = async (
    target: CredentialTarget,
    row: StoredCredentialRow,
    changes: CredentialSecretChange[],
    tally: PassTally,
  ): Promise<void> => {
    try {
      if (await database.writeChanges(target, row.id, changes)) {
        tally.valuesConverted += changes.length;
        return;
      }
      tally.rowsContended += 1;
    } catch (error) {
      if (
        !(error instanceof CredentialStoreError)
        || error.failure.sqlState === null
        || !ROW_SCOPED_SQLSTATES.has(error.failure.sqlState)
      ) {
        throw error;
      }
      tally.rowsFailed[error.failure.reason] = (tally.rowsFailed[error.failure.reason] ?? 0) + 1;
    }
  };

  const runPass = async (tally: PassTally): Promise<void> => {
    for (const target of CREDENTIAL_TARGETS) {
      let afterId = FIRST_CURSOR;
      for (;;) {
        if (now() >= deadline) {
          outcome.stopped = {
            operation: null,
            reason: TIME_BUDGET_REASON,
            sqlState: null,
            table: target.name,
          };
          return;
        }

        const rows = await database.readBatch(target, {
          afterId,
          batchSize,
          currentKeyId: primary.id,
        });
        if (rows.length === 0) {
          break;
        }
        afterId = rows.at(-1)?.id ?? afterId;

        for (const row of rows) {
          tally.rowsScanned += 1;
          const plan = planCredentialChanges(row, keyring, primary.id);
          for (const reason of plan.unreadable) {
            tally.valuesUnreadable[reason] = (tally.valuesUnreadable[reason] ?? 0) + 1;
          }
          if (plan.changes.length === 0) {
            continue;
          }
          await writeRow(target, row, plan.changes, tally);
        }
      }
    }
  };

  const recordPass = (tally: PassTally): void => {
    outcome.passes += 1;
    outcome.valuesConverted += tally.valuesConverted;
    outcome.rowsScanned = Math.max(outcome.rowsScanned, tally.rowsScanned);
    outcome.rowsContended = tally.rowsContended;
    outcome.rowsFailed = tally.rowsFailed;
    outcome.valuesUnreadable = tally.valuesUnreadable;
  };

  while (outcome.passes < maxPasses && outcome.stopped === null) {
    const tally = emptyTally();
    try {
      await runPass(tally);
    } catch (error) {
      if (!(error instanceof CredentialStoreError)) {
        throw error;
      }
      outcome.stopped = error.failure;
    }
    recordPass(tally);
    if (tally.rowsContended === 0 && Object.keys(tally.rowsFailed).length === 0) {
      break;
    }
  }

  if (
    outcome.stopped !== null
    || outcome.rowsContended > 0
    || Object.keys(outcome.rowsFailed).length > 0
    || Object.keys(outcome.valuesUnreadable).length > 0
  ) {
    outcome.status = "incomplete";
  }
  return outcome;
};

const CREDENTIAL_ENCRYPTION_MESSAGES: Record<CredentialEncryptionStatus, string> = {
  complete: "stored credentials are encrypted under the current key",
  incomplete: "some stored credentials are not yet encrypted under the current key",
  skipped: "stored credentials were left as they are",
};

const describeCredentialEncryption = (
  outcome: CredentialEncryptionOutcome,
  at: Date,
): CredentialEncryptionReport => {
  const keyCannotBeUsed = outcome.skipReason !== null && outcome.skipReason !== NO_KEY_REASON;
  let level = INFO_LEVEL;
  if (outcome.status === "incomplete" || keyCannotBeUsed) {
    level = WARN_LEVEL;
  }

  return {
    "credential_encryption.decrypt_only_key_ids": outcome.decryptOnlyKeyIds,
    "credential_encryption.passes": outcome.passes,
    "credential_encryption.primary_key_id": outcome.primaryKeyId,
    "credential_encryption.rows_contended": outcome.rowsContended,
    "credential_encryption.rows_failed": outcome.rowsFailed,
    "credential_encryption.rows_scanned": outcome.rowsScanned,
    "credential_encryption.skip_reason": outcome.skipReason,
    "credential_encryption.status": outcome.status,
    "credential_encryption.stopped": outcome.stopped,
    "credential_encryption.values_converted": outcome.valuesConverted,
    "credential_encryption.values_unreadable": outcome.valuesUnreadable,
    level,
    msg: CREDENTIAL_ENCRYPTION_MESSAGES[outcome.status],
    time: at.toISOString(),
  };
};

export {
  CREDENTIAL_TARGETS,
  CredentialStoreError,
  createCredentialEncryptionDatabase,
  describeCredentialEncryption,
  encryptStoredCredentials,
  resolveCredentialEncryptionKeys,
};
export type {
  CredentialEncryptionDatabase,
  CredentialEncryptionKeys,
  CredentialEncryptionOptions,
  CredentialEncryptionOutcome,
  CredentialEncryptionReport,
  CredentialEncryptionSettings,
  CredentialSecretChange,
  CredentialTarget,
  StoredCredentialRow,
};
