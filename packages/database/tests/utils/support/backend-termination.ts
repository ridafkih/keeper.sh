import type { SQL } from "bun";

const APPLICATION_NAME_MAX_BYTES = 63;

const applicationNameUrl = (databaseUrl: string, applicationName: string): string => {
  const byteLength = new TextEncoder().encode(applicationName).length;
  if (byteLength > APPLICATION_NAME_MAX_BYTES) {
    throw new Error(
      `application_name ${applicationName} is ${byteLength} bytes; Postgres truncates past ${APPLICATION_NAME_MAX_BYTES} and the termination filter would stop matching`,
    );
  }
  const url = new URL(databaseUrl);
  url.searchParams.set("application_name", applicationName);
  return url.toString();
};

const terminateBackendsRunning = async (
  killer: SQL,
  options: { applicationName: string; queryFragment: string },
): Promise<number[]> => {
  const rows = (await killer.unsafe(
    `with victims as materialized (
       select pid from pg_stat_activity
       where datname = current_database()
         and application_name = $1
         and query like $2
         and pid <> pg_backend_pid()
     )
     select pid from victims where pg_terminate_backend(pid)`,
    [options.applicationName, options.queryFragment],
  )) as { pid: number }[];

  return rows.map((row) => Number(row.pid));
};

export { applicationNameUrl, terminateBackendsRunning };
