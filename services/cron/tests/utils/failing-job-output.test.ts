import { join } from "node:path";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.KEEPER_TEST_DATABASE_URL;

const FIXTURE = join(import.meta.dirname, "../fixtures/failing-job-output.ts");

const BOUND_EMAIL = ["ada.lovelace", "example.com"].join("@");
const FAILED_STATEMENT = "Failed query: insert into job_accounts values ($1)";

interface JobRun {
  exitCode: number;
  output: string;
  wideEvents: Record<string, unknown>[];
}

const parseWideEvent = (line: string): Record<string, unknown>[] => {
  if (!line.startsWith("{")) {
    return [];
  }
  return [JSON.parse(line) as Record<string, unknown>];
};

const runFailingJob = async (): Promise<JobRun> => {
  const fixture = Bun.spawn(["bun", FIXTURE], {
    cwd: join(import.meta.dirname, "../.."),
    env: { ...process.env, PROBE_EMAIL: BOUND_EMAIL },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(fixture.stdout).text(),
    new Response(fixture.stderr).text(),
  ]);
  return {
    exitCode: await fixture.exited,
    output: `${stdout}\n${stderr}`,
    wideEvents: stdout.split("\n").flatMap((line) => parseWideEvent(line)),
  };
};

describe.skipIf(!databaseUrl)("what the cron process writes when a job's query fails", () => {
  it("names the statement and its SQLSTATE in the wide event without the bound value", async () => {
    const { wideEvents } = await runFailingJob();

    expect(wideEvents).toHaveLength(1);
    expect(wideEvents[0]).toMatchObject({
      db: { error_sqlstate: "23505" },
      error: { error_message: FAILED_STATEMENT, slug: "db-query-failed" },
      operation: { name: "failing-job", type: "job" },
      outcome: "error",
    });
    expect(JSON.stringify(wideEvents)).not.toContain(BOUND_EMAIL);
  });

  it("prints the scheduler's own failure report without the bound value", async () => {
    const { output } = await runFailingJob();

    expect(output).toContain("Cron job 'failing-job' failed:");
    expect(output).toContain('constraint: "job_accounts_email_key"');
    expect(output).toContain('detail: "Key (email)"');
    expect(output).not.toContain(BOUND_EMAIL);
  });

  it("prints a rejection nothing handled without the bound value", async () => {
    const { exitCode, output } = await runFailingJob();

    expect(exitCode).not.toBe(0);
    expect(output).toContain(`error: ${FAILED_STATEMENT}`);
    expect(output).not.toContain("params:");
    expect(output).not.toContain(BOUND_EMAIL);
  });
});
