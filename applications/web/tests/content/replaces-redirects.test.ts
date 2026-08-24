import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { buildMovedPaths, SEO_CONTENT_ROOT, type SupersedingPage } from "../../src/lib/content-paths";

const CONTENT_ROOT = join(import.meta.dirname, "../..", SEO_CONTENT_ROOT);
const COLLECTIONS = ["blog", "compare", "docs", "guides", "recipes"];
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

const pages: SupersedingPage[] = COLLECTIONS.flatMap((collection) => {
  const directory = join(CONTENT_ROOT, collection);
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".mdx"))
    .map((entry) => {
      const raw = readFileSync(join(directory, entry), "utf8").match(FRONTMATTER);
      const metadata = raw ? (parseYaml(raw[1]) as { replaces?: string[]; slug?: string }) : {};

      if (!metadata.slug) {
        throw new Error(`"${collection}/${entry}" has no slug, so its published path is unknown.`);
      }

      return { basePath: `/${collection}`, replaces: metadata.replaces, slug: metadata.slug };
    });
});

const published = new Set(pages.map((page) => `${page.basePath}/${page.slug}`));

describe.skipIf(!existsSync(join(CONTENT_ROOT, "blog")))("superseded paths", () => {
  it("has paths to check", () => {
    expect(Object.keys(buildMovedPaths(pages)).length).toBeGreaterThan(0);
  });

  it("redirects every superseded path to a page that exists", () => {
    const targets = Object.values(buildMovedPaths(pages));
    expect(targets.filter((target) => !published.has(target))).toEqual([]);
  });

  it("never redirects to a path that is itself superseded", () => {
    const moved = buildMovedPaths(pages);
    const chained = Object.values(moved).filter((target) => target in moved);
    expect(chained).toEqual([]);
  });
});
