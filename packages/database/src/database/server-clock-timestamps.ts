import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/*
 * Two kinds of value share these columns while they are still naked `timestamp`. The
 * application always sends `Date.toISOString()`, so its writes land as UTC wall clock
 * whatever the server zone is. A DEFAULT now() write lands as the SERVER's wall clock,
 * because now() returns timestamptz and casting it to timestamp goes through the session
 * zone. Converting the column to timestamptz reads every value as UTC, which is right for
 * the first kind and wrong by the server's offset for the second. Rewriting the server
 * clock values to UTC before the conversion makes both kinds agree.
 */

const ZONE_NAME_PATTERN = /^[A-Za-z0-9_+\-/]+$/u;

const SERVER_CLOCK_CANDIDATE_QUERY = `
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND data_type = 'timestamp without time zone'
    AND column_default LIKE 'now()%'
  ORDER BY table_name, column_name
`;

interface ServerClockCandidate {
  table: string;
  column: string;
}

interface ColumnOrigin {
  appRewrites: boolean;
}

const columnKey = ({ table, column }: ServerClockCandidate): string =>
  `${table}.${column}`;

/*
 * A column carrying $onUpdate is rewritten by the application on every update, so only
 * the rows it has never touched still hold a server clock value. Everything else with a
 * DEFAULT now() was written by the server and by nothing else.
 */
const describeColumnOrigins = (tables: PgTable[]): Map<string, ColumnOrigin> =>
  new Map(
    tables.flatMap((table) =>
      Object.values(getTableColumns(table)).map((column) => [
        columnKey({ column: column.name, table: getTableName(table) }),
        { appRewrites: Boolean(column.onUpdateFn) },
      ] as const)
    ),
  );

const findDiscriminator = (
  candidate: ServerClockCandidate,
  candidates: ServerClockCandidate[],
  origins: Map<string, ColumnOrigin>,
): string | null => {
  const siblings = candidates
    .filter(({ table, column }) =>
      table === candidate.table
      && column !== candidate.column
      && origins.get(columnKey({ column, table }))?.appRewrites === false)
    .map(({ column }) => column);
  return siblings.find((column) => column === "createdAt") ?? siblings[0] ?? null;
};

const buildRewrite = (
  { table, column }: ServerClockCandidate,
  zone: string,
): string =>
  `UPDATE "${table}"`
  + ` SET "${column}" = ("${column}" AT TIME ZONE '${zone}') AT TIME ZONE 'UTC'`
  + ` WHERE "${column}" IS NOT NULL`;

/*
 * An insert fills every DEFAULT now() column in the row from the same now(), so a
 * $onUpdate column that still equals its table's insert-only column has never been
 * written by the application and is safe to move. One that has diverged already holds
 * UTC and must be left alone. A table with no insert-only column offers no way to tell
 * the two apart, so its rows are left as they are rather than guessed at.
 *
 * The discriminated rewrites run first, because they read the very columns the plain
 * rewrites are about to move. Repairing createdAt first would leave every untouched
 * updatedAt looking like one the application had written.
 */
const buildServerClockRepairPlan = ({
  candidates,
  origins,
  zone,
}: {
  candidates: ServerClockCandidate[];
  origins: Map<string, ColumnOrigin>;
  zone: string;
}): string[] => {
  if (!ZONE_NAME_PATTERN.test(zone)) {
    throw new Error(`Refusing to build a timestamp repair for the zone name ${zone}`);
  }
  const appRewritten = candidates
    .filter((candidate) => origins.get(columnKey(candidate))?.appRewrites === true);
  const serverOnly = candidates
    .filter((candidate) => origins.get(columnKey(candidate))?.appRewrites !== true);
  return [
    ...appRewritten.flatMap((candidate) => {
      const discriminator = findDiscriminator(candidate, candidates, origins);
      if (!discriminator) {
        return [];
      }
      return [
        `${buildRewrite(candidate, zone)} AND "${candidate.column}" = "${discriminator}"`,
      ];
    }),
    ...serverOnly.map((candidate) => buildRewrite(candidate, zone)),
  ];
};

export {
  buildServerClockRepairPlan,
  describeColumnOrigins,
  SERVER_CLOCK_CANDIDATE_QUERY,
  type ColumnOrigin,
  type ServerClockCandidate,
};
