import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { XMLBuilder } from "fast-xml-parser";
import { parse as parseYaml } from "yaml";

const SITE_URL = "https://www.keeper.sh";
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface SitemapEntry {
  loc: string;
  lastmod: string;
}

interface StaticPage {
  path: string;
  updatedAt: string;
}

function isStaticPage(value: unknown): value is StaticPage {
  if (typeof value !== "object" || value === null) return false;
  const { path, updatedAt } = value as Record<string, unknown>;
  return (
    typeof path === "string" &&
    path.startsWith("/") &&
    typeof updatedAt === "string" &&
    ISO_DATE_PATTERN.test(updatedAt)
  );
}

function readStaticEntries(pagesFile: string): SitemapEntry[] {
  const pages: unknown = parseYaml(readFileSync(pagesFile, "utf-8"));

  if (!Array.isArray(pages)) {
    throw new Error(`Static page content at "${pagesFile}" must be a list of pages.`);
  }

  return pages.map((page: unknown) => {
    if (!isStaticPage(page)) {
      throw new Error(
        `Static page entry in "${pagesFile}" needs a "/" path and a YYYY-MM-DD updatedAt, received ${JSON.stringify(page)}.`,
      );
    }

    return { loc: `${SITE_URL}${page.path}`, lastmod: page.updatedAt };
  });
}

function buildIndexEntry(path: string, entries: SitemapEntry[]): SitemapEntry {
  const [first] = entries;
  if (!first) {
    throw new Error(`The "${path}" index lastmod cannot be derived without any entries.`);
  }

  const lastmod = entries.reduce(
    (newest, entry) => (entry.lastmod > newest ? entry.lastmod : newest),
    first.lastmod,
  );

  return { loc: `${SITE_URL}${path}`, lastmod };
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
      loc: `${SITE_URL}${basePath}/${frontmatter.slug}`,
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
      url: entries.map((entry) => ({
        loc: entry.loc,
        lastmod: entry.lastmod,
      })),
    },
  };

  return String(xmlBuilder.build(document));
}

export function sitemapPlugin(): Plugin {
  let blogDir: string;
  let compareDir: string;
  let docsDir: string;
  let guidesDir: string;
  let recipesDir: string;
  let pagesFile: string;

  return {
    name: "keeper-sitemap",
    apply: "build",

    configResolved(config) {
      blogDir = resolve(config.root, "src/content/blog");
      compareDir = resolve(config.root, "src/content/compare");
      docsDir = resolve(config.root, "src/content/docs");
      guidesDir = resolve(config.root, "src/content/guides");
      recipesDir = resolve(config.root, "src/content/recipes");
      pagesFile = resolve(config.root, "src/content/pages.yaml");
    },

    generateBundle() {
      const blogEntries = discoverContentEntries(blogDir, "/blog", "Blog post");
      const compareEntries = discoverContentEntries(
        compareDir,
        "/compare",
        "Comparison page",
      );
      const docsEntries = discoverContentEntries(docsDir, "/docs", "Docs page");
      const guidesEntries = discoverContentEntries(guidesDir, "/guides", "Guide");
      const recipesEntries = discoverContentEntries(recipesDir, "/recipes", "Recipe");
      const entries = [
        ...readStaticEntries(pagesFile),
        buildIndexEntry("/blog", blogEntries),
        ...blogEntries,
        buildIndexEntry("/compare", compareEntries),
        ...compareEntries,
        buildIndexEntry("/docs", docsEntries),
        ...docsEntries,
        buildIndexEntry("/guides", guidesEntries),
        ...guidesEntries,
        buildIndexEntry("/recipes", recipesEntries),
        ...recipesEntries,
      ];

      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: buildSitemapXml(entries),
      });
    },
  };
}
