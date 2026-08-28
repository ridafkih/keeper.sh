const OPENS_DO_BLOCK = /^\s*do\s+\$[a-z_]*\$/i;

const NON_IDEMPOTENT_STATEMENT_PATTERNS = [
  {
    kind: "CREATE TABLE",
    pattern: /\bcreate\s+table\s+(?!if\s+not\s+exists\b)/i,
    remedy: "without IF NOT EXISTS",
  },
  {
    kind: "CREATE INDEX",
    pattern: /\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?!if\s+not\s+exists\b)/i,
    remedy: "without IF NOT EXISTS",
  },
  {
    kind: "ADD COLUMN",
    pattern: /\badd\s+column\s+(?!if\s+not\s+exists\b)/i,
    remedy: "without IF NOT EXISTS",
  },
  {
    kind: "ADD CONSTRAINT",
    pattern: /\balter\s+table\b[\s\S]*?\badd\s+constraint\b/i,
    remedy: "outside a DO $$ ... IF NOT EXISTS block (Postgres has no ADD CONSTRAINT IF NOT EXISTS)",
  },
  {
    kind: "DROP COLUMN",
    pattern: /\bdrop\s+column\s+(?!if\s+exists\b)/i,
    remedy: "without IF EXISTS",
  },
  {
    kind: "DROP INDEX",
    pattern: /\bdrop\s+index\s+(?:concurrently\s+)?(?!if\s+exists\b)/i,
    remedy: "without IF EXISTS",
  },
  {
    kind: "DROP TABLE",
    pattern: /\bdrop\s+table\s+(?!if\s+exists\b)/i,
    remedy: "without IF EXISTS",
  },
  {
    kind: "DROP CONSTRAINT",
    pattern: /\bdrop\s+constraint\s+(?!if\s+exists\b)/i,
    remedy: "without IF EXISTS",
  },
];

const summarise = (statement: string) => statement.split("\n")[0]?.trim() ?? statement;

export const findNonIdempotentStatements = (sql: string): string[] =>
  sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .filter((statement) => !OPENS_DO_BLOCK.test(statement))
    .flatMap((statement) =>
      NON_IDEMPOTENT_STATEMENT_PATTERNS
        .filter(({ pattern }) => pattern.test(statement))
        .map(({ kind, remedy }) => `${kind} ${remedy} -> ${summarise(statement)}`),
    );
