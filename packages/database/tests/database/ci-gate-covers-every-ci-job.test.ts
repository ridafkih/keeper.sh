import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");

const workflowPath = resolve(repositoryRoot, ".github/workflows/checks.yml");
const turboConfigPath = resolve(repositoryRoot, "turbo.json");

const bunRunPattern = /bun\s+run\s+(?<rest>[^\n]+)/g;

const scriptOf = (invocation: string) => {
  const words = invocation.trim().split(/\s+/);
  const scriptIndex = words.findIndex(
    (word, index) => index > 0 && words[index - 1] !== "--filter" && !word.startsWith("-"),
  );
  const script = words[0] === "--filter" ? words[scriptIndex] : words[0];
  if (script === undefined || script.length === 0) {
    throw new Error(`Could not read a script name out of "bun run ${invocation}"`);
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

describe("the local turbo gate reaches every CI job", () => {
  it("declares a turbo task for every script the checks workflow runs", () => {
    const declared = new Set(turboTasks());
    const unreachable = workflowScripts().filter((script) => !declared.has(script));

    expect(unreachable).toEqual([]);
  });
});
