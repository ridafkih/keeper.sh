interface MigrationConnection {
  query: (statement: string) => Promise<{
    rowCount: number | null;
    rows: Record<string, unknown>[];
  }>;
}

const backfillEventMappingSyncEventIds = async (
  connection: MigrationConnection,
): Promise<number> => {
  await connection.query("BEGIN");

  try {
    await connection.query('LOCK TABLE "event_mappings" IN SHARE ROW EXCLUSIVE MODE');
    const updateResult = await connection.query(`
      UPDATE "event_mappings"
      SET "syncEventId" = "eventStateId"::text
      WHERE "syncEventId" IS NULL
    `);
    const verificationResult = await connection.query(`
      SELECT count(*)::integer AS "remainingCount"
      FROM "event_mappings"
      WHERE "syncEventId" IS NULL
    `);
    const remainingCount = verificationResult.rows[0]?.remainingCount;

    if (remainingCount !== 0) {
      throw new Error(
        `Event mapping sync identity backfill left ${String(remainingCount)} rows unresolved`,
      );
    }

    await connection.query("COMMIT");
    return updateResult.rowCount ?? 0;
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  }
};

export { backfillEventMappingSyncEventIds };
export type { MigrationConnection };
