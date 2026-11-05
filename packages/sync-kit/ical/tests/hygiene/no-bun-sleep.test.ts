import { Glob } from "bun";
import { describe, expect, test } from "vitest";
import { projectIcsFeed } from "../../src/index";
import { calendarWith, simpleEvent, testScope } from "../support/feed";
import { testOptions } from "../support/options";

const packageRoot = new URL("../../", import.meta.url).pathname;
const forbiddenPrimitive = ["Bun", "sleep"].join(".");

const sourceFiles = async (directory: string): Promise<readonly string[]> => {
  const glob = new Glob("**/*.ts");
  const found: string[] = [];
  for await (const relative of glob.scan({ cwd: `${packageRoot}${directory}` })) {
    found.push(`${packageRoot}${directory}/${relative}`);
  }
  return found;
};

const offendersIn = async (directory: string): Promise<readonly string[]> => {
  const files = await sourceFiles(directory);
  const offenders: string[] = [];
  for (const file of files) {
    const text = await Bun.file(file).text();
    if (text.includes(forbiddenPrimitive)) {
      offenders.push(file);
    }
  }
  return offenders;
};

const projectOnce = () =>
  projectIcsFeed({
    body: calendarWith([...simpleEvent("evt-1", "20260310T090000Z", "20260310T100000Z")]),
    scope: testScope,
    previousContentHash: null,
    options: testOptions(),
  });

describe("timing primitives fake timers cannot patch", () => {
  test("ICAL-L11: no file under src references the unfakeable sleep primitive", async () => {
    const files = await sourceFiles("src");
    const offenders = await offendersIn("src");

    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(30);
    expect(projectOnce().ok).toBe(true);
  });

  test("ICAL-L11: no file under tests references the unfakeable sleep primitive", async () => {
    const files = await sourceFiles("tests");
    const offenders = await offendersIn("tests");

    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(30);
    expect(projectOnce().ok).toBe(true);
  });

  test("ICAL-L11: the top-level entry point is synchronous, so no timing path exists to fake", () => {
    const returned = projectOnce();

    expect(returned).not.toBeInstanceOf(Promise);
    expect(returned.ok).toBe(true);
  });
});
