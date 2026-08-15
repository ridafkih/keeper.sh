import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const COMPARISON_TAG = "comparison";
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

const COLLECTIONS = [
  { basePath: "/blog", directory: "blog" },
  { basePath: "/compare", directory: "compare" },
];

interface Comparison {
  content: string;
  path: string;
}

function readComparisons(directory: string, basePath: string): Comparison[] {
  const collectionDirectory = join(import.meta.dirname, "../../src/content", directory);

  return readdirSync(collectionDirectory)
    .filter((entry) => entry.endsWith(".mdx"))
    .flatMap((entry) => {
      const raw = readFileSync(join(collectionDirectory, entry), "utf8");
      const match = raw.match(FRONTMATTER);
      if (!match) return [];

      const metadata = parseYaml(match[1]) as { slug?: string; tags?: string[] };
      if (!metadata.tags?.includes(COMPARISON_TAG)) return [];

      if (!metadata.slug) {
        throw new Error(`Comparison "${entry}" must declare a slug.`);
      }

      return [{ content: raw.slice(match[0].length), path: `${basePath}/${metadata.slug}` }];
    });
}

const comparisons = COLLECTIONS.flatMap(({ basePath, directory }) =>
  readComparisons(directory, basePath),
);

describe("comparison cross-links", () => {
  it("has comparisons to check", () => {
    expect(comparisons.length).toBeGreaterThan(1);
  });

  it.each(comparisons)("links $path to every other comparison", ({ content, path }) => {
    const unlinked = comparisons
      .filter((comparison) => comparison.path !== path)
      .filter((comparison) => !content.includes(`](${comparison.path})`))
      .map((comparison) => comparison.path);

    expect(unlinked).toEqual([]);
  });
});
