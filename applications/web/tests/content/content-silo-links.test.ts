import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEO_CONTENT_ROOT } from "../../src/lib/content-paths";
import { parseIndexableRoutePaths } from "../../src/lib/indexable-routes";
import { parse as parseYaml } from "yaml";

const CONTENT_ROOT = join(import.meta.dirname, "../..", SEO_CONTENT_ROOT);
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const INTERNAL_LINK = /]\((\/[^)#]*)(?:#[^)]*)?\)/g;
const STATIC_ASSET_LINK = /\.(avif|gif|ico|jpe?g|png|svg|webp)$/i;

const SILO_DIRECTORIES = ["docs", "guides", "recipes"];
const LINKED_DIRECTORIES = [...SILO_DIRECTORIES, "blog", "compare"];
const STATIC_PATHS = [
  "/",
  "/blog",
  "/compare",
  "/docs",
  "/features",
  "/guides",
  "/pricing",
  "/privacy",
  "/recipes",
  "/register",
  "/terms",
];

interface ContentPage {
  content: string;
  metadata: { blurb: string; slug?: string; tags?: string[] };
  path: string;
}

function readCollection(directory: string): ContentPage[] {
  const collectionDirectory = join(CONTENT_ROOT, directory);

  if (!existsSync(collectionDirectory)) return [];

  return readdirSync(collectionDirectory)
    .filter((entry) => entry.endsWith(".mdx"))
    .map((entry) => {
      const raw = readFileSync(join(collectionDirectory, entry), "utf8");
      const match = raw.match(FRONTMATTER);
      if (!match) {
        throw new Error(`"${directory}/${entry}" is missing a frontmatter block.`);
      }

      const metadata = parseYaml(match[1]) as ContentPage["metadata"];
      if (!metadata.slug) {
        throw new Error(`"${directory}/${entry}" must declare a slug.`);
      }

      return {
        content: raw.slice(match[0].length),
        metadata,
        path: `/${directory}/${metadata.slug}`,
      };
    });
}

const knownPaths = new Set([
  ...STATIC_PATHS,
  ...parseIndexableRoutePaths(
    readFileSync(
      join(import.meta.dirname, "../..", "src/generated/tanstack/route-tree.generated.ts"),
      "utf8",
    ),
  ),
  ...LINKED_DIRECTORIES.flatMap((directory) =>
    readCollection(directory).map((page) => page.path),
  ),
]);

const linkedPages = LINKED_DIRECTORIES.flatMap((directory) => readCollection(directory));
const recipes = readCollection("recipes");


const CONTENT_PRESENT = existsSync(
  join(import.meta.dirname, "../..", SEO_CONTENT_ROOT, "blog"),
);

describe.skipIf(!CONTENT_PRESENT)("content silos", () => {
  it.each(SILO_DIRECTORIES)("has pages in %s", (directory) => {
    expect(readCollection(directory).length).toBeGreaterThan(0);
  });

  it.each(linkedPages)("links $path only to pages that exist", ({ content }) => {
    const broken = [...content.matchAll(INTERNAL_LINK)]
      .map((match) => match[1])
      .filter((link) => !STATIC_ASSET_LINK.test(link) && !knownPaths.has(link));

    expect(broken).toEqual([]);
  });

  it.each(recipes)("leads $path with what it does, not with the plan it needs", ({ metadata }) => {
    expect(metadata.blurb).not.toMatch(/^(Needs|Requires|Runs on)\b/);
  });
});
