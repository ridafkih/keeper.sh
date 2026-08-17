import { describe, expect, test } from "vitest";
import { filesMatching, packageRoot, sourceFiles } from "../support/sources";

const readmeText = (): Promise<string> => Bun.file(`${packageRoot}README.md`).text();

describe("tsdav is extended, not replaced", () => {
  test("DAV-H1: src imports tsdav and never smartCollectionSync", async () => {
    const importers = await filesMatching("src", 'from "tsdav"');
    const replacements = await filesMatching("src", "smartCollectionSync");

    expect(importers.length).toBeGreaterThan(0);
    expect(replacements).toEqual([]);
  });

  test("DAV-H1: discovery and every DAV verb go through tsdav rather than a hand-rolled request", async () => {
    const files = await sourceFiles("src");
    const discovery = await filesMatching("src", "fetchCalendars");
    const ownFetch = await filesMatching("src", "new Request(");

    expect(files).toContain("src/client/dav-client.ts");
    expect(discovery).toEqual(["src/calendars/discover.ts"]);
    expect(ownFetch).toEqual([]);
  });

  test("DAV-H21: the README names each extension point and the tsdav line that forced it", async () => {
    const readme = await readmeText();

    for (const point of [
      "calendarMultiGet",
      "authMethod",
      "syncCollection",
      "resource-path.ts",
    ]) {
      expect(readme).toContain(point);
    }
    expect(readme).toContain("smartCollectionSync");
  });
});
