import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

const appRewrittenColumns = (tables: PgTable[]): string[] =>
  tables.flatMap((table) =>
    Object.values(getTableColumns(table))
      .filter((column) => column.onUpdateFn)
      .map((column) => `${getTableName(table)}.${column.name}`));

const SERVER_CLOCK_REPAIR_PLAN_QUERY = `
  WITH candidate AS (
    SELECT
      table_name,
      column_name,
      (table_name || '.' || column_name) = ANY($1::text[]) AS app_rewritten
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'timestamp without time zone'
      AND column_default LIKE 'now()%'
  ),
  insert_only_sibling AS (
    SELECT
      table_name,
      (array_agg(column_name ORDER BY column_name <> 'createdAt', column_name))[1]
        AS column_name
    FROM candidate
    WHERE NOT app_rewritten
    GROUP BY table_name
  )
  SELECT
    format(
      'UPDATE %I SET %I = (%I AT TIME ZONE %L) AT TIME ZONE ''UTC'' WHERE %I IS NOT NULL',
      candidate.table_name,
      candidate.column_name,
      candidate.column_name,
      $2::text,
      candidate.column_name
    )
    || CASE
      WHEN candidate.app_rewritten
      THEN format(
        ' AND %I = %I',
        candidate.column_name,
        insert_only_sibling.column_name
      )
      ELSE ''
    END AS statement
  FROM candidate
  LEFT JOIN insert_only_sibling USING (table_name)
  WHERE NOT candidate.app_rewritten OR insert_only_sibling.column_name IS NOT NULL
  ORDER BY candidate.app_rewritten DESC, candidate.table_name, candidate.column_name
`;

export { appRewrittenColumns, SERVER_CLOCK_REPAIR_PLAN_QUERY };
