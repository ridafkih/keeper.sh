import { describe, expect, it, vi } from "vitest";
import {
  backfillEventMappingSyncEventIds,
  type MigrationConnection,
} from "../../src/database/backfill-event-mapping-sync-event-ids";

const createConnection = (
  results: { rowCount: number | null; rows: Record<string, unknown>[] }[],
): { connection: MigrationConnection; statements: string[] } => {
  const statements: string[] = [];
  const query = vi.fn((statement: string) => {
    statements.push(statement);
    return Promise.resolve(results.shift() ?? { rowCount: 0, rows: [] });
  });

  return {
    connection: { query },
    statements,
  };
};

describe("event mapping sync identity backfill", () => {
  it("backfills legacy identities under a write-blocking lock and verifies completion", async () => {
    const { connection, statements } = createConnection([
      { rowCount: null, rows: [] },
      { rowCount: null, rows: [] },
      { rowCount: 12, rows: [] },
      { rowCount: 1, rows: [{ remainingCount: 0 }] },
      { rowCount: null, rows: [] },
    ]);

    await expect(backfillEventMappingSyncEventIds(connection)).resolves.toBe(12);

    expect(statements).toHaveLength(5);
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toContain('LOCK TABLE "event_mappings"');
    expect(statements[2]).toContain('SET "syncEventId" = "eventStateId"::text');
    expect(statements[2]).toContain('WHERE "syncEventId" IS NULL');
    expect(statements[3]).toContain('WHERE "syncEventId" IS NULL');
    expect(statements[4]).toBe("COMMIT");
  });

  it("is idempotent when every mapping already has a sync identity", async () => {
    const { connection } = createConnection([
      { rowCount: null, rows: [] },
      { rowCount: null, rows: [] },
      { rowCount: 0, rows: [] },
      { rowCount: 1, rows: [{ remainingCount: 0 }] },
      { rowCount: null, rows: [] },
    ]);

    await expect(backfillEventMappingSyncEventIds(connection)).resolves.toBe(0);
  });

  it("rolls back and fails startup when a null identity remains", async () => {
    const { connection, statements } = createConnection([
      { rowCount: null, rows: [] },
      { rowCount: null, rows: [] },
      { rowCount: 4, rows: [] },
      { rowCount: 1, rows: [{ remainingCount: 1 }] },
      { rowCount: null, rows: [] },
    ]);

    await expect(backfillEventMappingSyncEventIds(connection)).rejects.toThrow(
      "left 1 rows unresolved",
    );
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
  });
});
