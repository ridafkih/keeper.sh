import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDefaultLoggerConfig } from "./wide-logging-config";

const originalNodeEnv = process.env.NODE_ENV;
const originalEnv = process.env.ENV;
const originalLogLevel = process.env.LOG_LEVEL;

describe("wide logging", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    delete process.env.ENV;
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.ENV = originalEnv;
    process.env.LOG_LEVEL = originalLogLevel;
  });

  it("defaults to silent logging during tests when ENV is unset", () => {
    const config = getDefaultLoggerConfig();

    expect(config.level).toBe("silent");
    expect(config.environment).toBe("test");
  });

  it("deduplicates repeated error messages while preserving counts", () => {
    const result = Bun.spawnSync({
      cmd: [
        "bun",
        "-e",
        `
          import {
            initializeWideLogger,
            reportError,
            runWideEvent,
            shutdownLogging,
          } from "./packages/provider-core/src/utils/wide-logging.ts";

          initializeWideLogger({ level: "info", service: "test-service" });

          await runWideEvent(
            { "operation.name": "test", "operation.type": "test" },
            async () => {
              reportError(new Error("duplicate boom"));
              reportError(new Error("duplicate boom"));
            },
          );

          await shutdownLogging();
        `,
      ],
      cwd: process.cwd(),
      env: {
        ...process.env,
        LOG_LEVEL: "info",
        NODE_ENV: "development",
      },
    });

    const output = new TextDecoder().decode(result.stdout).replaceAll(/\u001B\[[0-9;]*m/g, "");

    expect(result.exitCode).toBe(0);
    expect(output).toContain('"count": 2');
    expect(output).toContain('"messages": [\n          "duplicate boom"\n        ]');
  });
});
