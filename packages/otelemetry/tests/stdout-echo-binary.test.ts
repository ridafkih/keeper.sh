import { afterAll, describe, expect, it } from "vitest";

const BINARY_PATH = new URL("../src/index.ts", import.meta.url).pathname;

const pinoLine = (level: number, message: string) =>
  JSON.stringify({ level, time: Date.now(), service: "keeper-test", msg: message });

const LOG_LINES = [
  pinoLine(30, "sync finished"),
  pinoLine(20, "fetched calendar"),
  pinoLine(40, "provider slow"),
  pinoLine(50, "write failed"),
  "TypeError: undefined is not an object",
];

const collectedBodies: string[] = [];
const collector = Bun.serve({
  port: 0,
  fetch: async (request) => {
    collectedBodies.push(await request.text());
    return Response.json({});
  },
});

afterAll(async () => {
  await collector.stop(true);
});

const runBinary = async (environment: Record<string, string>) => {
  const subprocess = Bun.spawn(["bun", BINARY_PATH, "cat"], {
    env: { PATH: process.env.PATH, ...environment },
    stdin: new Blob([`${LOG_LINES.join("\n")}\n`]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  return { stdout, stderr, exitCode: await subprocess.exited };
};

const collectorEnvironment = () => ({
  OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collector.port}`,
  OTEL_SERVICE_NAME: "keeper-test",
  VERSION: "2.34.6",
  ENV: "test",
});

describe("keeper-otelemetry stdout echo", () => {
  it("echoes only lines at the configured level and above while every line reaches the collector", async () => {
    const { stdout, exitCode } = await runBinary({ ...collectorEnvironment(), STDOUT_LOG_LEVEL: "warn" });

    expect(exitCode).toBe(0);
    expect(stdout.trim().split("\n")).toEqual([LOG_LINES[2], LOG_LINES[3], LOG_LINES[4]]);
    const collected = collectedBodies.join("\n");
    for (const message of ["sync finished", "fetched calendar", "provider slow", "write failed"]) {
      expect(collected).toContain(message);
    }
  });

  it("echoes everything when the level is set to trace", async () => {
    const { stdout } = await runBinary({ ...collectorEnvironment(), STDOUT_LOG_LEVEL: "trace" });

    expect(stdout.trim().split("\n")).toEqual(LOG_LINES);
  });

  it("stops at startup when a collector is configured without a stdout level", async () => {
    const { stderr, exitCode } = await runBinary(collectorEnvironment());

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("STDOUT_LOG_LEVEL");
  });

  it("writes every line to stdout when no collector is configured", async () => {
    const { stdout, exitCode } = await runBinary({});

    expect(exitCode).toBe(0);
    expect(stdout.trim().split("\n")).toEqual(LOG_LINES);
  });
});
