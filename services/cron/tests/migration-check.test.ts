import { describe, expect, it, vi } from "vitest";
import { checkWorkerMigrationStatus } from "../src/migration-check";

describe("checkWorkerMigrationStatus", () => {
  it("does not exit when WORKER_JOB_QUEUE_ENABLED is true", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    checkWorkerMigrationStatus(true);

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("does not exit when WORKER_JOB_QUEUE_ENABLED is false", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    checkWorkerMigrationStatus(false);

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("exits with code 1 when WORKER_JOB_QUEUE_ENABLED is undefined", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      // eslint-disable-next-line @eslint/no-undefined @eslint-plugin-unicorn/no-useless-undefined
      checkWorkerMigrationStatus(undefined);
    } catch {
      // Expected — mock throws to prevent actual exit
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("writes migration guide to stderr when WORKER_JOB_QUEUE_ENABLED is undefined", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      // eslint-disable-next-line @eslint/no-undefined @eslint-plugin-unicorn/no-useless-undefined
      checkWorkerMigrationStatus(undefined);
    } catch {
      // Expected
    }

    const output = stderrSpy.mock.calls[0]?.[0];
    expect(output).toContain("KEEPER MIGRATION REQUIRED");
    expect(output).toContain("WORKER_JOB_QUEUE_ENABLED=true");
    expect(output).toContain("WORKER_JOB_QUEUE_ENABLED=false");
    expect(output).toContain("https://github.com/ridafkih/keeper.sh/issues/267");

    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
