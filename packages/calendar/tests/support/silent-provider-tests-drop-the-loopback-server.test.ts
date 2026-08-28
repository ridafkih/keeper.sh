import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const testsRoot = resolve(import.meta.dirname, "..");
const guardFile = resolve(import.meta.filename);

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

describe("silent provider tests drop the loopback server", () => {
  it("finds test files to range over", async () => {
    const files = await collectTestFiles();

    expect(files.length).toBeGreaterThan(3);
  });

  it("pairs no Bun.serve handler with a server teardown call anywhere under tests", async () => {
    const files = await collectTestFiles();

    const offenders: string[] = [];
    for (const file of files) {
      const source = await Bun.file(file).text();
      if (source.includes("Bun.serve") && source.includes("stop(")) {
        offenders.push(relative(testsRoot, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
