import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");

const workspaceGlobs = () => {
  const root = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")) as {
    workspaces?: { packages?: string[] } | string[];
  };
  const globs = Array.isArray(root.workspaces) ? root.workspaces : root.workspaces?.packages;
  if (globs === undefined || globs.length === 0) {
    throw new Error("The root package.json declares no workspaces globs");
  }
  return globs;
};

const workspaceManifestPaths = () => {
  const paths = workspaceGlobs().flatMap((glob) => [
    ...new Bun.Glob(`${glob}/package.json`).scanSync({ cwd: repositoryRoot, absolute: true }),
  ]);
  if (paths.length === 0) {
    throw new Error("No workspace package.json files matched the root workspaces globs");
  }
  return paths.toSorted();
};

const testScriptOf = (manifestPath: string) => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  return manifest.scripts?.test;
};

const withoutEnvironmentPrefix = (script: string) => {
  const words = script.trim().split(/\s+/);
  const firstCommand = words.findIndex((word) => !/^[A-Z_][A-Z0-9_]*=/.test(word));
  if (firstCommand === -1) {
    throw new Error(`"${script}" is only environment assignments and never runs a command`);
  }
  return words.slice(firstCommand).join(" ");
};

describe("every workspace test script runs vitest under bun", () => {
  it("never dispatches vitest through a node shebang", () => {
    const offenders = workspaceManifestPaths()
      .map((manifestPath) => ({
        workspace: relative(repositoryRoot, manifestPath),
        script: testScriptOf(manifestPath),
      }))
      .filter(
        (entry): entry is { workspace: string; script: string } => entry.script !== undefined,
      )
      .filter((entry) => !withoutEnvironmentPrefix(entry.script).startsWith("bun x --bun vitest"))
      .map((entry) => `${entry.workspace}: ${entry.script}`);

    expect(offenders).toEqual([]);
  });
});
