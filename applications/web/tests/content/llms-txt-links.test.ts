import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { SEO_CONTENT_ROOT } from "../../src/lib/content-paths";
import { parseIndexableRoutePaths } from "../../src/lib/indexable-routes";

const WEB_ROOT = join(import.meta.dirname, "../..");
const CONTENT_ROOT = join(WEB_ROOT, SEO_CONTENT_ROOT);
const COLLECTIONS = ["blog", "compare", "docs", "guides", "recipes"];
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const SITE_PATH = /https:\/\/www\.keeper\.sh(\/[a-z0-9/.-]*)/g;

const pathsIn = (collection: string): string[] => {
  const directory = join(CONTENT_ROOT, collection);
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".mdx"))
    .map((entry) => {
      const raw = readFileSync(join(directory, entry), "utf8").match(FRONTMATTER);
      const slug = raw ? (parseYaml(raw[1]) as { slug?: string }).slug : undefined;

      if (!slug) {
        throw new Error(`"${collection}/${entry}" has no slug, so its published path is unknown.`);
      }

      return `/${collection}/${slug}`;
    });
};

const published = new Set([
  ...parseIndexableRoutePaths(
    readFileSync(join(WEB_ROOT, "src/generated/tanstack/route-tree.generated.ts"), "utf8"),
  ),
  ...COLLECTIONS.flatMap(pathsIn),
]);

const referenced = [
  ...readFileSync(join(WEB_ROOT, "public/llms.txt"), "utf8").matchAll(SITE_PATH),
]
  .map((match) => match[1].replace(/\/$/, ""))
  .filter((path) => path.length > 0 && !path.includes("."));

describe.skipIf(!existsSync(join(CONTENT_ROOT, "blog")))("llms.txt", () => {
  it("references pages that exist", () => {
    expect(referenced.length).toBeGreaterThan(0);
    expect([...new Set(referenced)].filter((path) => !published.has(path))).toEqual([]);
  });
});
