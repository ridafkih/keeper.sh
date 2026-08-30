import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { CONTENT_DIRECTORIES } from "../src/lib/content-paths";
import { XMLBuilder } from "fast-xml-parser";
import { parse as parseYaml } from "yaml";
import { staticPageMetadata } from "../src/lib/page-metadata";
import {
  assertIndexableRoutesCovered,
  parseIndexableRoutePaths,
} from "../src/lib/indexable-routes";
import { processChangelogDirectory } from "../src/lib/changelog-content";

const SITE_URL = "https://www.keeper.sh";
const BLOG_BASE_PATH = "/blog";
const COMPARE_BASE_PATH = "/compare";
const DOCS_BASE_PATH = "/docs";
const GUIDES_BASE_PATH = "/guides";
const RECIPES_BASE_PATH = "/recipes";
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface SitemapEntry {
  path: string;
  lastmod?: string;
}

/** Public static files that are not HTML marketing pages. Kept out of staticPageMetadata so they skip the HTML cache. */
export const staticAssetSitemapPaths = ["/llms.txt"] as const;

function readStaticEntries(): SitemapEntry[] {
  return staticPageMetadata.map(({ path, updatedAt }) => {
    if (!ISO_DATE_PATTERN.test(updatedAt)) {
      throw new Error(
        `Static page "${path}" needs a YYYY-MM-DD updatedAt, received ${JSON.stringify(updatedAt)}.`,
      );
    }

    return { path, lastmod: updatedAt };
  });
}

function buildIndexEntry(path: string, entries: SitemapEntry[]): SitemapEntry {
  const [first] = entries;
  if (!first) return { path };

  const lastmod = entries.reduce(
    (newest, entry) => (entry.lastmod > newest ? entry.lastmod : newest),
    first.lastmod,
  );

  return { path, lastmod };
}

/**
 * The hub takes the newest release's date, and every release folder becomes its
 * own entry. `buildSitemapXml` prepends the origin, so these carry a path only.
 */
function buildChangelogEntries(changelogDir: string): SitemapEntry[] {
  const releases = processChangelogDirectory(changelogDir);
  const [newest] = releases;

  if (!newest) return [];

  return [
    { path: "/changelog", lastmod: newest.date },
    ...releases.map((release) => ({
      path: `/changelog/${release.slug}`,
      lastmod: release.date,
    })),
  ];
}

function parseFrontmatter(raw: string, file: string): Record<string, unknown> {
  const match = raw.match(FRONTMATTER_PATTERN);
  if (!match) {
    throw new Error(`"${file}" is missing a YAML frontmatter block.`);
  }
  return parseYaml(match[1]);
}

function discoverContentEntries(
  directory: string,
  basePath: string,
  label: string,
): SitemapEntry[] {
  if (!existsSync(directory)) return [];

  const files = readdirSync(directory).filter((file) => file.endsWith(".mdx"));

  return files.map((file) => {
    const raw = readFileSync(join(directory, file), "utf-8");
    const frontmatter = parseFrontmatter(raw, file);

    if (typeof frontmatter.slug !== "string") {
      throw new Error(`${label} "${file}" is missing a slug.`);
    }

    if (typeof frontmatter.updatedAt !== "string") {
      throw new Error(`${label} "${file}" is missing updatedAt.`);
    }

    return {
      path: `${basePath}/${frontmatter.slug}`,
      lastmod: frontmatter.updatedAt.slice(0, 10),
    };
  });
}

const xmlBuilder = new XMLBuilder({
  format: true,
  ignoreAttributes: false,
  suppressEmptyNode: true,
});

function buildSitemapXml(entries: SitemapEntry[]): string {
  const document = {
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
    urlset: {
      "@_xmlns": "http://www.sitemaps.org/schemas/sitemap/0.9",
      url: entries.map((entry) =>
        entry.lastmod
          ? { loc: `${SITE_URL}${entry.path}`, lastmod: entry.lastmod }
          : { loc: `${SITE_URL}${entry.path}` },
      ),
    },
  };

  return String(xmlBuilder.build(document));
}

export function sitemapPlugin(): Plugin {
  let blogDir: string;
  let compareDir: string;
  let changelogDir: string;
  let docsDir: string;
  let guidesDir: string;
  let recipesDir: string;
  let routeTreeFile: string;

  return {
    name: "keeper-sitemap",
    apply: "build",

    configResolved(config) {
      blogDir = resolve(config.root, CONTENT_DIRECTORIES.blog);
      compareDir = resolve(config.root, CONTENT_DIRECTORIES.compare);
      changelogDir = resolve(config.root, CONTENT_DIRECTORIES.changelog);
      docsDir = resolve(config.root, CONTENT_DIRECTORIES.docs);
      guidesDir = resolve(config.root, CONTENT_DIRECTORIES.guides);
      recipesDir = resolve(config.root, CONTENT_DIRECTORIES.recipes);
      routeTreeFile = resolve(config.root, "src/generated/tanstack/route-tree.generated.ts");
    },

    generateBundle() {
      const staticEntries = readStaticEntries();
      const blogEntries = discoverContentEntries(blogDir, BLOG_BASE_PATH, "Blog post");
      const compareEntries = discoverContentEntries(
        compareDir,
        COMPARE_BASE_PATH,
        "Comparison page",
      );
      const docsEntries = discoverContentEntries(docsDir, DOCS_BASE_PATH, "Docs page");
      const guidesEntries = discoverContentEntries(guidesDir, GUIDES_BASE_PATH, "Guide");
      const recipesEntries = discoverContentEntries(recipesDir, RECIPES_BASE_PATH, "Recipe");

      const blogIndexEntry = buildIndexEntry(BLOG_BASE_PATH, blogEntries);
      const compareIndexEntry = buildIndexEntry(COMPARE_BASE_PATH, compareEntries);
      const docsIndexEntry = buildIndexEntry(DOCS_BASE_PATH, docsEntries);
      const guidesIndexEntry = buildIndexEntry(GUIDES_BASE_PATH, guidesEntries);
      const recipesIndexEntry = buildIndexEntry(RECIPES_BASE_PATH, recipesEntries);

      assertIndexableRoutesCovered(
        [
          ...staticEntries,
          blogIndexEntry,
          compareIndexEntry,
          docsIndexEntry,
          guidesIndexEntry,
          recipesIndexEntry,
        ].map((entry) => entry.path),
        parseIndexableRoutePaths(readFileSync(routeTreeFile, "utf-8")),
      );

      const entries = [
        ...staticEntries,
        blogIndexEntry,
        ...blogEntries,
        compareIndexEntry,
        ...compareEntries,
        docsIndexEntry,
        ...docsEntries,
        guidesIndexEntry,
        ...guidesEntries,
        recipesIndexEntry,
        ...recipesEntries,
        ...buildChangelogEntries(changelogDir),
        ...staticAssetSitemapPaths.map((path) => ({ path })),
      ];

      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: buildSitemapXml(entries),
      });
    },
  };
}
