import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(fileURLToPath(import.meta.url), "../../..");

const flushTransactionSuites = [
  "tests/jobs/ingest-caldav-host-limiter-per-request.test.ts",
  "tests/jobs/ingest-duration-attribution.test.ts",
  "tests/jobs/ingest-first-calendar-push.test.ts",
  "tests/jobs/ingest-flush-item-deadline-wiring.test.ts",
  "tests/jobs/ingest-flush-lock-bound.test.ts",
  "tests/jobs/ingest-flush-stored-event-count.test.ts",
  "tests/jobs/ingest-flush-unattributed-time.test.ts",
  "tests/jobs/ingest-flush-writer.test.ts",
  "tests/jobs/ingest-ics-host-limiter-consumption.test.ts",
  "tests/jobs/ingest-lock-release-flake.test.ts",
  "tests/jobs/ingest-persist-probe-writer-slot.test.ts",
  "tests/jobs/ingest-pool-and-limiter-attribution.test.ts",
  "tests/jobs/ingest-preflight-serial-slot.test.ts",
  "tests/jobs/ingest-reserve-before-fetch.test.ts",
];

describe("the transaction fakes support the typed baseline read", () => {
  it("keeps every flush-transaction suite on the uncontended commit path", async () => {
    const child = Bun.spawn(["bun", "x", "--bun", "vitest", "run", ...flushTransactionSuites], {
      cwd: packageRoot,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const output = `${stdout}\n${stderr}`;

    expect(output).not.toContain("IngestBaselineMovedError");
    expect(output).not.toContain("calendar source ingestions failed");
    expect(exitCode, output.slice(-6000)).toBe(0);
  }, 300_000);
});
