import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import databaseVitestConfig from "../../vitest.config";

const packageRoot = resolve(import.meta.dirname, "../..");

const declaredSetupFiles = () => {
  const declared = databaseVitestConfig.test?.setupFiles;
  if (declared === undefined) {
    return [];
  }
  return typeof declared === "string" ? [declared] : [...declared];
};

const resolvedSetupFiles = () =>
  declaredSetupFiles().map((entry) => resolve(packageRoot, entry.replace(/^\.\//, "")));

const guardSetupFile = () =>
  resolvedSetupFiles().find((path) => path.includes("database-suite-guard"));

describe("the database workspace runs the skip guard before any suite", () => {
  it("registers a setup file with vitest", () => {
    expect(resolvedSetupFiles().length).toBeGreaterThan(0);
  });

  it("registers the database suite guard as that setup file", () => {
    const guard = guardSetupFile();

    expect(guard).toBeDefined();
    expect(existsSync(guard as string)).toBe(true);
  });

  it("invokes the assertion at import time against the real environment", () => {
    const guard = guardSetupFile();

    expect(guard).toBeDefined();

    const source = readFileSync(guard as string, "utf8");

    expect(source).toMatch(/^assertDatabaseSuiteCanRun\(process\.env\);$/m);
  });
});
