import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const CONTENT_ROOT = join(import.meta.dirname, "../../src/content");
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const INTERNAL_LINK = /]\((\/[^)#]*)(?:#[^)]*)?\)/g;

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
  ...LINKED_DIRECTORIES.flatMap((directory) =>
    readCollection(directory).map((page) => page.path),
  ),
]);

const siloPages = SILO_DIRECTORIES.flatMap((directory) => readCollection(directory));
const recipes = readCollection("recipes");

describe("content silos", () => {
  it.each(SILO_DIRECTORIES)("has pages in %s", (directory) => {
    expect(readCollection(directory).length).toBeGreaterThan(0);
  });

  it.each(siloPages)("links $path only to pages that exist", ({ content }) => {
    const broken = [...content.matchAll(INTERNAL_LINK)]
      .map((match) => match[1])
      .filter((link) => !knownPaths.has(link));

    expect(broken).toEqual([]);
  });

  it.each(recipes)("states the plan $path runs on in its blurb", ({ metadata }) => {
    expect(metadata.blurb).toMatch(/\b(Free|Pro)\b/);
  });
});
