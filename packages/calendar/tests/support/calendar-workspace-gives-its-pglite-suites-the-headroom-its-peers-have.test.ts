import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import calendarVitestConfig from "../../vitest.config";

const testsRoot = resolve(import.meta.dirname, "..");
const guardFile = resolve(import.meta.filename);

const postgresGradeTimeoutMs = 60_000;

const collectTestFiles = async () => {
  const glob = new Bun.Glob("**/*.test.ts");
  const files: string[] = [];
  for await (const match of glob.scan({ cwd: testsRoot, absolute: true })) {
    if (resolve(match) !== guardFile) {
      files.push(resolve(match));
    }
  }
  if (files.length === 0) {
    throw new Error(`no test files were found under ${testsRoot}`);
  }
  return files.toSorted();
};

const collectPgliteTestFiles = async () => {
  const files = await collectTestFiles();
  const importers: string[] = [];
  for (const file of files) {
    const source = await Bun.file(file).text();
    if (source.includes("@electric-sql/pglite")) {
      importers.push(relative(testsRoot, file));
    }
  }
  return importers;
};

const timeoutsOfCalendarWorkspace = () => {
  const { test } = calendarVitestConfig;
  if (test === undefined) {
    throw new Error("packages/calendar/vitest.config.ts declares no test section");
  }
  const { hookTimeout, testTimeout } = test;
  return { hookTimeout, testTimeout };
};

describe("calendar workspace gives its pglite suites the headroom its peers have", () => {
  it("finds test files to range over", async () => {
    const files = await collectTestFiles();

    expect(files.length).toBeGreaterThan(3);
  });

  it("carries postgres-grade hook and test timeouts whenever a suite boots pglite", async () => {
    const importers = await collectPgliteTestFiles();

    if (importers.length === 0) {
      expect(importers).toEqual([]);
      return;
    }

    const timeouts = timeoutsOfCalendarWorkspace();

    expect(timeouts).toEqual({
      hookTimeout: expect.any(Number),
      testTimeout: expect.any(Number),
    });
    expect(timeouts.hookTimeout).toBeGreaterThanOrEqual(postgresGradeTimeoutMs);
    expect(timeouts.testTimeout).toBeGreaterThanOrEqual(postgresGradeTimeoutMs);
  });
});
