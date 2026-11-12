import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { SEO_CONTENT_ROOT } from "../../src/lib/content-paths";
import { parseIndexableRoutePaths } from "../../src/lib/indexable-routes";
import type { CompareCopy } from "../../src/lib/marketing-content";

const CONTENT_ROOT = join(import.meta.dirname, "../..", SEO_CONTENT_ROOT);
const HUB_COPY_FILE = join(CONTENT_ROOT, "marketing/compare.json");
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const LINKED_DIRECTORIES = ["blog", "compare", "docs", "guides", "recipes"];

function readCollectionPaths(directory: string): string[] {
  const collectionDirectory = join(CONTENT_ROOT, directory);
  if (!existsSync(collectionDirectory)) return [];

  return readdirSync(collectionDirectory)
    .filter((entry) => entry.endsWith(".mdx"))
    .map((entry) => {
      const match = readFileSync(join(collectionDirectory, entry), "utf8").match(FRONTMATTER);
      const metadata = match ? (parseYaml(match[1]) as { slug?: string }) : {};
      if (!metadata.slug) {
        throw new Error(`"${directory}/${entry}" must declare a slug.`);
      }

      return `/${directory}/${metadata.slug}`;
    });
}

function internalPathsOf(hub: CompareCopy): string[] {
  const figureLinks = hub.table.rows.flatMap((row) =>
    [row.price, row.freePlan, row.calendars, row.speed].map((figure) => figure.href),
  );

  return [
    hub.header.guides.link.path,
    ...hub.table.rows.flatMap((row) => (row.path ? [row.path] : [])),
    ...figureLinks.filter((href) => href.startsWith("/")),
    ...hub.groups.flatMap((group) => group.links.map((link) => link.path)),
  ];
}

describe.skipIf(!existsSync(HUB_COPY_FILE))("compare hub copy", () => {
  const readHub = (): CompareCopy => JSON.parse(readFileSync(HUB_COPY_FILE, "utf8"));
  const comparePaths = readCollectionPaths("compare");

  it("links only to pages that exist", () => {
    const knownPaths = new Set([
      "/",
      "/blog",
      ...parseIndexableRoutePaths(
        readFileSync(
          join(import.meta.dirname, "../..", "src/generated/tanstack/route-tree.generated.ts"),
          "utf8",
        ),
      ),
      ...LINKED_DIRECTORIES.flatMap(readCollectionPaths),
    ]);

    expect(internalPathsOf(readHub()).filter((path) => !knownPaths.has(path))).toEqual([]);
  });

  it("names every compare page in a group", () => {
    const groupedPaths = new Set(readHub().groups.flatMap((group) => group.links.map((link) => link.path)));

    expect(comparePaths.filter((path) => !groupedPaths.has(path))).toEqual([]);
  });

  it("names each article in one group only", () => {
    const paths = readHub().groups.flatMap((group) => group.links.map((link) => link.path));

    expect(paths.filter((path, index) => paths.indexOf(path) !== index)).toEqual([]);
  });
});
