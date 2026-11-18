import { BunSQLPreparedQuery } from "drizzle-orm/bun-sql";
import { withoutBoundValues } from "./errors";

type QueryRunner = (
  this: unknown,
  queryString: string,
  params: unknown[],
  query: () => Promise<unknown>,
) => Promise<unknown>;

interface QueryRunnerHost {
  queryWithCache?: QueryRunner;
}

let installed = false;

const keepBoundValuesOutOfQueryErrors = (): void => {
  if (installed) {
    return;
  }
  const host = BunSQLPreparedQuery.prototype as unknown as QueryRunnerHost;
  const runQuery = host.queryWithCache;
  if (typeof runQuery !== "function") {
    throw new TypeError("drizzle-orm no longer runs Bun SQL queries through queryWithCache");
  }
  host.queryWithCache = async function queryWithCache(queryString, params, query) {
    try {
      return await runQuery.call(this, queryString, params, query);
    } catch (error) {
      throw withoutBoundValues(error);
    }
  };
  installed = true;
};

export { keepBoundValuesOutOfQueryErrors };
