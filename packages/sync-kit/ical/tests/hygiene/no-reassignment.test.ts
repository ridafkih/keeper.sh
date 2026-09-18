import { Glob } from "bun";
import { describe, expect, test } from "vitest";

const packageRoot = new URL("../../", import.meta.url).pathname;

/*
 * A rebindable name is state a reader has to simulate. Both forms are checked: a `let` in
 * statement position, and a `let` in a classic for-loop header. Anchoring to the start of a
 * line keeps prose in a comment from reading as a declaration.
 */
const statementBinding = /^\s*let\s+[A-Za-z_$]/;
const loopBinding = /\(\s*let\s+[A-Za-z_$]/;

const sourceFiles = async (directory: string): Promise<readonly string[]> => {
  const glob = new Glob("**/*.ts");
  const found: string[] = [];
  for await (const relative of glob.scan({ cwd: `${packageRoot}${directory}` })) {
    found.push(relative);
  }
  return found;
};

const offendersIn = async (directory: string): Promise<readonly string[]> => {
  const files = await sourceFiles(directory);
  const offenders: string[] = [];
  for (const relative of files) {
    const text = await Bun.file(`${packageRoot}${directory}/${relative}`).text();
    for (const [index, line] of text.split("\n").entries()) {
      if (statementBinding.test(line) || loopBinding.test(line)) {
        offenders.push(`${directory}/${relative}:${String(index + 1)}`);
      }
    }
  }
  return offenders;
};

describe("rebindable names", () => {
  test("ICAL-H20: no file under src declares a let", async () => {
    const files = await sourceFiles("src");
    const offenders = await offendersIn("src");

    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(30);
  });
});
