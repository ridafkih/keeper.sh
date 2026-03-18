import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { XMLBuilder } from "fast-xml-parser";
import { parse as parseYaml } from "yaml";

const SITE_URL = "https://keeper.sh";
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;

interface SitemapEntry {
  loc: string;
  lastmod: string;
}

const staticEntries: SitemapEntry[] = [
  { loc: `${SITE_URL}/`, lastmod: "2026-03-09" },
  { loc: `${SITE_URL}/blog`, lastmod: "2026-03-09" },
  { loc: `${SITE_URL}/privacy`, lastmod: "2025-12-01" },
  { loc: `${SITE_URL}/terms`, lastmod: "2025-12-01" },
];

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

  return {
    name: "keeper-sitemap",
    apply: "build",

    configResolved(config) {
      blogDir = resolve(config.root, "src/content/blog");
    },

    generateBundle() {
      const blogEntries = discoverBlogEntries(blogDir);
      const entries = [...staticEntries, ...blogEntries];

      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: buildSitemapXml(entries),
      });
    },
  };
}
