import { SQL } from "bun";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.KEEPER_TEST_DATABASE_URL;

const SLEEPING_QUERY = "select pg_sleep(2)";
const QUERY_FRAGMENT = "%pg_sleep(2)%";
const STATEMENT_REACHES_SERVER_MS = 400;

type TerminateBackendsRunning = (
  killer: SQL,
  options: { applicationName: string; queryFragment: string },
) => Promise<number[]>;

const loadTerminator = async () => {
  try {
    const module = (await import("./support/backend-termination")) as {
      terminateBackendsRunning?: TerminateBackendsRunning;
    };
    return { failure: null as unknown, terminate: module.terminateBackendsRunning };
  } catch (error: unknown) {
    return { failure: error, terminate: undefined };
  }
};

const openSession = async (applicationName: string) => {
  const client = new SQL({ max: 1, prepare: false, url: databaseUrl ?? "" });
  await client.unsafe("select set_config('application_name', $1, false)", [applicationName]);
  const [row] = (await client.unsafe("select pg_backend_pid() as pid", [])) as { pid: number }[];
  if (!row) {
    throw new Error("expected pg_backend_pid() to return a row");
  }
  return { client, pid: Number(row.pid) };
};

const sleepingOutcome = async (client: SQL) => {
  try {
    await client.unsafe(SLEEPING_QUERY, []);
    return "survived";
  } catch (error: unknown) {
    return `died: ${(error as { message?: string }).message ?? String(error)}`;
  }
};

describe.skipIf(!databaseUrl)("terminating the live driver test's own backends", () => {
  it("kills only the backends belonging to the killer's own application", async () => {
    const { terminate, failure } = await loadTerminator();

    expect(
      failure,
      "packages/database/tests/utils/support/backend-termination.ts must export terminateBackendsRunning so the live-driver kill can be scoped instead of matching on query text alone",
    ).toBeNull();
    expect(terminate).toBeTypeOf("function");

    const suffix = crypto.randomUUID();
    const ownApplication = `keeper-kill-probe-own-${suffix}`;
    const foreignApplication = `keeper-kill-probe-foreign-${suffix}`;

    const killer = new SQL({ max: 1, prepare: false, url: databaseUrl ?? "" });
    const own = await openSession(ownApplication);
    const foreign = await openSession(foreignApplication);

    try {
      const ownOutcome = sleepingOutcome(own.client);
      const foreignOutcome = sleepingOutcome(foreign.client);
      await Bun.sleep(STATEMENT_REACHES_SERVER_MS);

      const terminated = await (terminate as TerminateBackendsRunning)(killer, {
        applicationName: ownApplication,
        queryFragment: QUERY_FRAGMENT,
      });

      expect(await foreignOutcome).toBe("survived");
      expect(await ownOutcome).toMatch(/^died: /);
      expect(terminated.map(Number)).toContain(own.pid);
      expect(terminated.map(Number)).not.toContain(foreign.pid);
    } finally {
      await killer.close();
      await own.client.close();
      await foreign.client.close();
    }
  }, 30_000);
});
