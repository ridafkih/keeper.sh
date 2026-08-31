const guidance = () =>
  [
    "KEEPER_TEST_DATABASE_URL is not set, so the database suite would skip every test and still exit 0.",
    "Stand Postgres up with `docker compose -f compose.yaml up -d postgres` at the repository root, then export",
    "KEEPER_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres.",
    "To run a partial suite on purpose, set KEEPER_TEST_DATABASE_OPTIONAL=1.",
  ].join(" ");

export const assertDatabaseSuiteCanRun = (environment: Record<string, string | undefined>) => {
  const configured = environment.KEEPER_TEST_DATABASE_URL ?? "";
  const optedOut = environment.KEEPER_TEST_DATABASE_OPTIONAL ?? "";
  if (configured.length > 0 || optedOut.length > 0) {
    return;
  }
  throw new Error(guidance());
};
