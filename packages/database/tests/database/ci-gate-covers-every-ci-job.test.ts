import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");

const workflowPath = resolve(repositoryRoot, ".github/workflows/checks.yml");
const turboConfigPath = resolve(repositoryRoot, "turbo.json");
const rootPackageJsonPath = resolve(repositoryRoot, "package.json");

const bunRunPattern = /\bbunx?(?:\s+x)?\s+(?:turbo\s+)?run\s+(?<rest>[^\n]+)/g;

const matrixExpressionPattern = /\$\{\{.*?\}\}/g;

const scriptOf = (invocation: string) => {
  const words = invocation.replace(matrixExpressionPattern, " ").trim().split(/\s+/);
  const scriptIndex = words.findIndex(
    (word, index) => index > 0 && words[index - 1] !== "--filter" && !word.startsWith("-"),
  );
  const script = words[0] === "--filter" ? words[scriptIndex] : words[0];
  if (script === undefined || script.length === 0) {
    throw new Error(`Could not read a script name out of "${invocation}"`);
  }
  return script;
};

const workflowScripts = () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const scripts = [...workflow.matchAll(bunRunPattern)].map((match) =>
    scriptOf(match.groups?.rest ?? ""),
  );
  if (scripts.length === 0) {
    throw new Error(`No "bun run" commands found in ${workflowPath}`);
  }
  return [...new Set(scripts)].toSorted();
};

const turboTasks = () => {
  const parsed = JSON.parse(readFileSync(turboConfigPath, "utf8")) as {
    tasks?: Record<string, unknown>;
  };
  if (parsed.tasks === undefined) {
    throw new Error(`${turboConfigPath} declares no tasks map`);
  }
  return Object.keys(parsed.tasks).toSorted();
};

const gateTasks = () => {
  const parsed = JSON.parse(readFileSync(rootPackageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const gate = parsed.scripts?.gate;
  if (gate === undefined) {
    throw new Error(
      `${rootPackageJsonPath} declares no "gate" script, so no single command runs ${workflowScripts().join(", ")}`,
    );
  }
  const words = gate.trim().split(/\s+/);
  const runIndex = words.indexOf("run");
  if (runIndex === -1) {
    throw new Error(`The "gate" script does not invoke turbo run: ${gate}`);
  }
  const tasks = words.slice(runIndex + 1).filter((word) => !word.startsWith("-"));
  if (tasks.length === 0) {
    throw new Error(`The "gate" script passes no turbo tasks: ${gate}`);
  }
  return new Set(tasks);
};

describe("one named gate command runs every CI script", () => {
  it("declares a turbo task for every script the checks workflow runs", () => {
    const declared = new Set(turboTasks());
    const unreachable = workflowScripts().filter((script) => !declared.has(script));

    expect(unreachable).toEqual([]);
  });

  it("runs every script the checks workflow runs from the root gate script", () => {
    const tasks = gateTasks();
    const unrun = workflowScripts().filter((script) => !tasks.has(script));

    expect(unrun).toEqual([]);
  });

  it("harvests the test task the sharded workflow job runs", () => {
    expect(workflowScripts()).toContain("test");
  });
});
