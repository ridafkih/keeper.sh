import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { XMLBuilder } from "fast-xml-parser";
import { parse as parseYaml } from "yaml";
import { staticPages } from "../lib/page-metadata";

const SITE_URL = "https://keeper.sh";
const BLOG_DIRECTORY = "src/content/blog";
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const xmlBuilder = new XMLBuilder({
  format: true,
  ignoreAttributes: false,
  suppressEmptyNode: true,
});

interface SitemapEntry {
  loc: string;
  lastmod: string;
}

interface BlogFrontmatter {
  slug: string;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseIsoDate(dateValue: string): string {
  const normalizedDate = dateValue.slice(0, 10);
  if (!ISO_DATE_PATTERN.test(normalizedDate)) {
    throw new Error(`Invalid ISO date: "${dateValue}".`);
  }

  return normalizedDate;
}

function toBlogFrontmatter(value: unknown, filePath: string): BlogFrontmatter {
  if (!isRecord(value)) {
    throw new Error(`Blog frontmatter is not an object in "${filePath}".`);
  }

  if (typeof value.slug !== "string") {
    throw new Error(`Blog frontmatter is missing a slug in "${filePath}".`);
  }

  if (typeof value.updatedAt !== "string") {
    throw new Error(`Blog frontmatter is missing updatedAt in "${filePath}".`);
  }

  return {
    slug: value.slug,
    updatedAt: value.updatedAt,
  };
}

function parseFrontmatter(rawContent: string, filePath: string): BlogFrontmatter {
  const frontmatterMatch = rawContent.match(FRONTMATTER_PATTERN);
  if (!frontmatterMatch) {
    throw new Error(`Blog post is missing frontmatter in "${filePath}".`);
  }

  const parsedFrontmatter = parseYaml(frontmatterMatch[1]);
  return toBlogFrontmatter(parsedFrontmatter, filePath);
}

function extractBlogEntry(filePath: string): SitemapEntry {
  const rawContent = readFileSync(filePath, "utf-8");
  const frontmatter = parseFrontmatter(rawContent, filePath);

  return {
    loc: `${SITE_URL}/blog/${frontmatter.slug}`,
    lastmod: parseIsoDate(frontmatter.updatedAt),
  };
}

function readBlogFileNames(blogDirectoryPath: string): string[] {
  if (!existsSync(blogDirectoryPath)) {
    return [];
  }

  const directoryStats = statSync(blogDirectoryPath);
  if (!directoryStats.isDirectory()) {
    return [];
  }

  return readdirSync(blogDirectoryPath).filter((f) => f.endsWith(".mdx"));
}

function discoverBlogEntries(): SitemapEntry[] {
  const blogDirectoryPath = resolve(process.cwd(), BLOG_DIRECTORY);
  const blogFileNames = readBlogFileNames(blogDirectoryPath);

  return blogFileNames.map((fileName) =>
    extractBlogEntry(join(blogDirectoryPath, fileName)),
  );
}

function getStaticEntries(): SitemapEntry[] {
  return staticPages.map((page) => ({
    loc: `${SITE_URL}${page.path}`,
    lastmod: page.updatedAt,
  }));
}

export function generateSitemap(): string {
  const entries = [...getStaticEntries(), ...discoverBlogEntries()];

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
