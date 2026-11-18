import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "..", "src", "healthcheck.ts");
const MINUTE_MS = 60_000;

const directories: string[] = [];

const createDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "keeper-cron-healthcheck-"));
  directories.push(directory);
  return directory;
};

const runHealthcheck = (directory: string): { exitCode: number; output: string } => {
  const result = Bun.spawnSync(["bun", SCRIPT], {
    env: { PATH: process.env.PATH, TMPDIR: directory },
    stderr: "pipe",
    stdout: "pipe",
  });
  return { exitCode: result.exitCode, output: result.stdout.toString() };
};

const writeHeartbeat = (directory: string, pulses: Record<string, { beatAt: number; staleAfterMs: number }>): void => {
  writeFileSync(
    join(directory, "keeper-cron.heartbeat.json"),
    JSON.stringify({ pulses, writtenAt: Date.now() }),
  );
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("cron healthcheck command", () => {
  it("needs no service configuration and passes when no heartbeat exists", () => {
    const result = runHealthcheck(createDirectory());

    expect(result).toEqual({ exitCode: 0, output: "heartbeat absent\n" });
  });

  it("passes while every loop progressed recently", () => {
    const directory = createDirectory();
    writeHeartbeat(directory, {
      "ingest-fleet": { beatAt: Date.now() - 10 * MINUTE_MS, staleAfterMs: 15 * MINUTE_MS },
      "ingest-wake": { beatAt: Date.now(), staleAfterMs: 15 * MINUTE_MS },
      "jobs": { beatAt: Date.now() - MINUTE_MS, staleAfterMs: 15 * MINUTE_MS },
    });

    expect(runHealthcheck(directory)).toEqual({ exitCode: 0, output: "heartbeat fresh\n" });
  });

  it("fails once one loop has not progressed within its allowance", () => {
    const directory = createDirectory();
    writeHeartbeat(directory, {
      "ingest-fleet": { beatAt: Date.now() - 16 * MINUTE_MS, staleAfterMs: 15 * MINUTE_MS },
      "ingest-wake": { beatAt: Date.now(), staleAfterMs: 15 * MINUTE_MS },
      "jobs": { beatAt: Date.now(), staleAfterMs: 15 * MINUTE_MS },
    });

    const result = runHealthcheck(directory);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("heartbeat stale: ingest-fleet last progressed");
  });
});
