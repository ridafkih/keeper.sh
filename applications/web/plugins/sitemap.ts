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

function buildBlogIndexEntry(blogEntries: SitemapEntry[]): SitemapEntry {
  const [first] = blogEntries;
  if (!first) {
    throw new Error("The blog index lastmod cannot be derived without any blog posts.");
  }

  const lastmod = blogEntries.reduce(
    (newest, entry) => (entry.lastmod > newest ? entry.lastmod : newest),
    first.lastmod,
  );

  return { loc: `${SITE_URL}/blog`, lastmod };
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  const [, match] = raw.match(FRONTMATTER_PATTERN);
  if (!match) return {};
  return parseYaml(match);
}

function discoverBlogEntries(blogDir: string): SitemapEntry[] {
  const files = readdirSync(blogDir).filter((f) => f.endsWith(".mdx"));

  return files.map((file) => {
    const raw = readFileSync(join(blogDir, file), "utf-8");
    const frontmatter = parseFrontmatter(raw);

    if (typeof frontmatter.slug !== "string") {
      throw new Error(`Blog post "${file}" is missing a slug.`);
    }

    if (typeof frontmatter.updatedAt !== "string") {
      throw new Error(`Blog post "${file}" is missing updatedAt.`);
    }

    return {
      loc: `${SITE_URL}/blog/${frontmatter.slug}`,
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
  let pagesFile: string;

  return {
    name: "keeper-sitemap",
    apply: "build",

    configResolved(config) {
      blogDir = resolve(config.root, "src/content/blog");
      pagesFile = resolve(config.root, "src/content/pages.yaml");
    },

    generateBundle() {
      const blogEntries = discoverBlogEntries(blogDir);
      const entries = [
        ...readStaticEntries(pagesFile),
        buildBlogIndexEntry(blogEntries),
        ...blogEntries,
      ];

      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: buildSitemapXml(entries),
      });
    },
  };
}
