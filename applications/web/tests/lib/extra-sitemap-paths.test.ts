import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extraSitemapPaths } from "../../src/lib/extra-sitemap-paths";

const PUBLIC_ROOT = join(import.meta.dirname, "../../public");

describe("extraSitemapPaths", () => {
  it("includes the live llms.txt file", () => {
    expect([...extraSitemapPaths]).toEqual(["/llms.txt"]);
  });

  it("points at files that exist in public/", () => {
    for (const path of extraSitemapPaths) {
      expect(existsSync(join(PUBLIC_ROOT, path))).toBe(true);
    }
  });
});
