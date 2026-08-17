interface LockTimeoutConnection {
  query: (sql: string) => Promise<unknown>;
}

const BLOCKING_LOCK_TIMEOUT = "10s";

/*
 * CREATE/DROP INDEX CONCURRENTLY waits on the virtual transaction locks of every session that
 * can still see the table, which is precisely what a session lock_timeout cancels. The
 * cancellation leaves the index present and invalid, and each later run then aborts the same
 * way, so the failure repairs itself only once the timeout is lifted.
 */
const withoutLockTimeout = async <Result>(
  connection: LockTimeoutConnection,
  work: () => Promise<Result>,
): Promise<Result> => {
  await connection.query(`SET lock_timeout = 0`);
  try {
    return await work();
  } finally {
    await connection.query(`SET lock_timeout = '${BLOCKING_LOCK_TIMEOUT}'`);
  }
};

export { BLOCKING_LOCK_TIMEOUT, withoutLockTimeout };
export type { LockTimeoutConnection };
