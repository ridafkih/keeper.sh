import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEO_CONTENT_ROOT } from "../../src/lib/content-paths";
import { parseIndexableRoutePaths } from "../../src/lib/indexable-routes";

const WEB_ROOT = join(import.meta.dirname, "../..");
const CONTENT_ROOT = join(WEB_ROOT, SEO_CONTENT_ROOT);
const COLLECTIONS = ["blog", "compare", "docs", "guides", "recipes"];
const CONTENT_URL = /https:\/\/www\.keeper\.sh\/(blog|compare|docs|guides|recipes)\/([a-z0-9-]+)/g;

const slugsIn = (collection: string): string[] => {
  const directory = join(CONTENT_ROOT, collection);
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".mdx"))
    .map((entry) => {
      const frontmatter = readFileSync(join(directory, entry), "utf8").match(/^slug:\s*"([^"]+)"/m);
      return frontmatter ? frontmatter[1] : entry.replace(/\.mdx$/, "");
    });
};

const routePaths = parseIndexableRoutePaths(
  readFileSync(join(WEB_ROOT, "src/generated/tanstack/route-tree.generated.ts"), "utf8"),
);

const published = new Set([
  ...routePaths,
  ...COLLECTIONS.flatMap((collection) =>
    slugsIn(collection).map((slug) => `/${collection}/${slug}`),
  ),
]);

const referenced = [
  ...readFileSync(join(WEB_ROOT, "public/llms.txt"), "utf8").matchAll(CONTENT_URL),
].map((match) => `/${match[1]}/${match[2]}`);

describe.skipIf(!existsSync(join(CONTENT_ROOT, "blog")))("llms.txt", () => {
  it("references content that exists", () => {
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((path) => !published.has(path))).toEqual([]);
  });
});
