import { Glob } from "bun";
import { describe, expect, test } from "vitest";
import { createZoneCache, zoneCacheStatistics } from "../../src/index";

const sweepDirectory = new URL("../zone/sweeps/", import.meta.url).pathname;

const sweepFiles = async (): Promise<readonly string[]> => {
  const glob = new Glob("*.test.ts");
  const found: string[] = [];
  for await (const relative of glob.scan({ cwd: sweepDirectory })) {
    found.push(`${sweepDirectory}${relative}`);
  }
  return found.toSorted();
};

const topLevelTestCount = (text: string): number =>
  text.split("\n").filter((line) => line.startsWith("  test(") || line.startsWith("test(")).length;

describe("the CPU-heavy tzdb sweeps", () => {
  test("ICAL-L12: every file under tests/zone/sweeps declares exactly one test", async () => {
    const files = await sweepFiles();

    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      expect(`${file}:${topLevelTestCount(await Bun.file(file).text())}`).toBe(`${file}:1`);
    }
    expect(zoneCacheStatistics(createZoneCache()).formatterConstructions).toBe(0);
  });

  test("ICAL-L12: each sweep builds its own zone cache, so workers cannot share or poison state", async () => {
    const files = await sweepFiles();

    for (const file of files) {
      expect(await Bun.file(file).text()).toContain("createZoneCache()");
    }
    expect(zoneCacheStatistics(createZoneCache()).offsetProbes).toBe(0);
  });
});
