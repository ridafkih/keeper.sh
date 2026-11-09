import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isLlmsTextFileName, readLlmsTextFiles } from "../../src/lib/llms-text-files";

const temporaryRoots: string[] = [];

const createContentRoot = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "keeper-llms-"));
  temporaryRoots.push(root);

  for (const [fileName, content] of Object.entries(files)) {
    writeFileSync(join(root, fileName), content);
  }

  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("readLlmsTextFiles", () => {
  it("reads both llms text files from the seo content", () => {
    const root = createContentRoot({ "llms.txt": "# Keeper.sh", "llms-full.txt": "# Keeper.sh full" });

    expect(readLlmsTextFiles(root)).toEqual([
      { content: "# Keeper.sh", fileName: "llms.txt" },
      { content: "# Keeper.sh full", fileName: "llms-full.txt" },
    ]);
  });

  it("reports missing files without throwing so self-hosted builds still succeed", () => {
    expect(readLlmsTextFiles(join(tmpdir(), "keeper-llms-absent"))).toEqual([
      { content: null, fileName: "llms.txt" },
      { content: null, fileName: "llms-full.txt" },
    ]);
  });
});

describe("isLlmsTextFileName", () => {
  it("matches only the published llms text files", () => {
    expect(isLlmsTextFileName("llms.txt")).toBe(true);
    expect(isLlmsTextFileName("llms-full.txt")).toBe(true);
    expect(isLlmsTextFileName("robots.txt")).toBe(false);
  });
});
