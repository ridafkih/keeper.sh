import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { type } from "arktype";
import { parse as parseYaml } from "yaml";

const OPEN_GRAPH_IMAGE_WIDTH = 1200;
const OPEN_GRAPH_IMAGE_HEIGHT = 630;
const OPEN_GRAPH_IMAGE_PATH =
  /^\/open-graph\/[a-z0-9]+(?:-[a-z0-9]+)*\.png$/;

const blogPostMetadataSchema = type({
  "+": "reject",
  blurb: "string >= 1",
  createdAt: "string.date.iso",
  description: "string >= 1",
  "image?": OPEN_GRAPH_IMAGE_PATH,
  "slug?": /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  tags: "string[]",
  title: "string >= 1",
  updatedAt: "string.date.iso",
});

type BlogPostMetadata = typeof blogPostMetadataSchema.infer;

export interface ProcessedBlogPost {
  content: string;
  metadata: BlogPostMetadata;
  slug: string;
}

function toIsoDate(value: string): string {
  return value.slice(0, 10);
}

function normalizeMetadataInput(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const normalized: Record<string, unknown> = { ...value };

  if (normalized.createdAt instanceof Date) {
    normalized.createdAt = normalized.createdAt.toISOString();
  }
  if (normalized.updatedAt instanceof Date) {
    normalized.updatedAt = normalized.updatedAt.toISOString();
  }

  return normalized;
}

function splitFrontmatter(
  raw: string,
  filePath: string,
): { content: string; data: unknown } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    throw new Error(
      `Blog post "${filePath}" must start with a YAML frontmatter block.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(match[1]);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown YAML parse error";
    throw new Error(
      `Blog frontmatter parsing failed for "${filePath}": ${message}`,
    );
  }

  return {
    content: raw.slice(match[0].length).trimStart(),
    data: parsed ?? {},
  };
}

function parseMetadata(value: unknown, filePath: string): BlogPostMetadata {
  const result = blogPostMetadataSchema(normalizeMetadataInput(value));
  if (result instanceof type.errors) {
    throw new Error(
      `Blog metadata is invalid for "${filePath}": ${result}`,
    );
  }

  if (result.tags.length === 0) {
    throw new Error(
      `Blog metadata tags must contain at least one tag in "${filePath}".`,
    );
  }

  return {
    ...result,
    createdAt: toIsoDate(result.createdAt),
    updatedAt: toIsoDate(result.updatedAt),
  };
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readPngDimensions(
  file: Buffer,
): { height: number; width: number } | null {
  if (file.length < 24 || !file.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }
  return { height: file.readUInt32BE(20), width: file.readUInt32BE(16) };
}

function assertOpenGraphImage(
  imagePath: string,
  publicDir: string,
  filePath: string,
): void {
  const absolutePath = join(publicDir, imagePath);
  if (!existsSync(absolutePath)) {
    throw new Error(
      `Blog post "${filePath}" references an Open Graph image that does not exist at "public${imagePath}".`,
    );
  }

  const dimensions = readPngDimensions(readFileSync(absolutePath));
  if (!dimensions) {
    throw new Error(
      `Open Graph image "public${imagePath}" referenced by "${filePath}" is not a valid PNG.`,
    );
  }

  if (
    dimensions.width !== OPEN_GRAPH_IMAGE_WIDTH ||
    dimensions.height !== OPEN_GRAPH_IMAGE_HEIGHT
  ) {
    throw new Error(
      `Open Graph image "public${imagePath}" referenced by "${filePath}" must be ${OPEN_GRAPH_IMAGE_WIDTH}x${OPEN_GRAPH_IMAGE_HEIGHT}, but is ${dimensions.width}x${dimensions.height}.`,
    );
  }
}

function createSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function removeRedundantLeadingHeading(
  content: string,
  title: string,
): string {
  const lines = content.split("\n");
  const firstLine = lines[0]?.trim() ?? "";

  if (!firstLine.startsWith("# ")) return content;

  const headingText = firstLine.slice(2).trim().toLowerCase();
  if (headingText !== title.trim().toLowerCase()) return content;

  let nextIndex = 1;
  while (nextIndex < lines.length && lines[nextIndex].trim().length === 0) {
    nextIndex += 1;
  }

  return lines.slice(nextIndex).join("\n");
}

export function processBlogDirectory(
  blogDir: string,
  publicDir: string,
): ProcessedBlogPost[] {
  const files = readdirSync(blogDir)
    .filter((f) => f.endsWith(".mdx"))
    .sort();

  const slugCounts = new Map<string, number>();

  const posts = files.map((file) => {
    const filePath = join(blogDir, file);
    const raw = readFileSync(filePath, "utf-8");
    const { content: rawContent, data } = splitFrontmatter(raw, file);
    const metadata = parseMetadata(data, file);
    const content = removeRedundantLeadingHeading(rawContent, metadata.title);

    if (metadata.image) {
      assertOpenGraphImage(metadata.image, publicDir, file);
    }

    const hasCustomSlug = typeof metadata.slug === "string";
    const baseSlug = hasCustomSlug ? metadata.slug : createSlug(metadata.title);
    const seenCount = slugCounts.get(baseSlug) ?? 0;

    if (hasCustomSlug && seenCount > 0) {
      throw new Error(`Duplicate blog slug "${baseSlug}" found in metadata.`);
    }

    slugCounts.set(baseSlug, seenCount + 1);
    const slug = seenCount === 0 ? baseSlug : `${baseSlug}-${seenCount + 1}`;

    return { content, metadata, slug };
  });

  return posts.sort((a, b) =>
    b.metadata.createdAt.localeCompare(a.metadata.createdAt),
  );
}

const VIRTUAL_MODULE_ID = "virtual:blog-posts";
const RESOLVED_ID = `\0${VIRTUAL_MODULE_ID}`;

export function blogPlugin(): Plugin {
  let blogDir: string;
  let publicDir: string;

  return {
    name: "keeper-blog",

    configResolved(config) {
      blogDir = resolve(config.root, "src/content/blog");
      publicDir = config.publicDir;
    },

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) return RESOLVED_ID;
    },

    load(id) {
      if (id !== RESOLVED_ID) return;

      const posts = processBlogDirectory(blogDir, publicDir);
      return `export const blogPosts = ${JSON.stringify(posts)};`;
    },

    handleHotUpdate({ file, server }) {
      if (file.startsWith(blogDir) && file.endsWith(".mdx")) {
        const module = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (module) {
          server.moduleGraph.invalidateModule(module);
          return [module];
        }
      }
    },
  };
}
