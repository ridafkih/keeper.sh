import { describe, expect, test } from "vitest";
import { filesMatching, sourceFiles } from "../support/sources";

const forbiddenImports = [
  "@keeper.sh/database",
  "@keeper.sh/queue",
  "@keeper.sh/otelemetry",
  "bun:sqlite",
  "Bun.sql",
  "Bun.redis",
];

describe("this package holds no store and no scheduler", () => {
  test("DAV-H15: src imports no database or queue package", async () => {
    const offenders: string[] = [];
    for (const forbidden of forbiddenImports) {
      const matches = await filesMatching("src", forbidden);
      offenders.push(...matches.map((file) => `${file} imports ${forbidden}`));
    }

    expect(offenders).toEqual([]);
  });

  test("DAV-H15: the whole src tree was walked, not an empty directory", async () => {
    const files = await sourceFiles("src");

    expect(files).toContain("src/index.ts");
    expect(files).toContain("src/listing/list-changes.ts");
  });
});
