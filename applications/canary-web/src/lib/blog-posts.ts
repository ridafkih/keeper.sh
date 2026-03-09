import { type } from "arktype";
import { parse as parseYaml } from "yaml";

const blogPostMetadataSchema = type({
  "+": "reject",
  blurb: "string >= 1",
  createdAt: "string.date.iso",
  description: "string >= 1",
  "slug?": /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  tags: "string[]",
  title: "string >= 1",
  updatedAt: "string.date.iso",
});

export type BlogPostMetadata = typeof blogPostMetadataSchema.infer;

export interface BlogPost {
  content: string;
  metadata: BlogPostMetadata;
  slug: string;
}

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toIsoDate(value: string): string {
  return value.slice(0, 10);
}

function normalizeMetadataInput(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalizedValue: Record<string, unknown> = { ...value };

  if (normalizedValue.createdAt instanceof Date) {
    normalizedValue.createdAt = normalizedValue.createdAt.toISOString();
  }

  if (normalizedValue.updatedAt instanceof Date) {
    normalizedValue.updatedAt = normalizedValue.updatedAt.toISOString();
  }

  return normalizedValue;
}

function parseMetadata(value: unknown, filePath: string): BlogPostMetadata {
  const metadataResult = blogPostMetadataSchema(normalizeMetadataInput(value));
  if (metadataResult instanceof type.errors) {
    throw new Error(`Blog metadata is invalid for "${filePath}": ${metadataResult}`);
  }

  if (metadataResult.tags.length === 0) {
    throw new Error(`Blog metadata tags must contain at least one tag in "${filePath}".`);
  }

  return {
    ...metadataResult,
    createdAt: toIsoDate(metadataResult.createdAt),
    updatedAt: toIsoDate(metadataResult.updatedAt),
  };
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
  const contentLines = content.split("\n");
  const firstLine = contentLines[0]?.trim() ?? "";

  if (!firstLine.startsWith("# ")) {
    return content;
  }

  const headingText = firstLine.slice(2).trim().toLowerCase();
  const normalizedTitle = title.trim().toLowerCase();
  if (headingText !== normalizedTitle) {
    return content;
  }

  let nextLineIndex = 1;
  while (
    nextLineIndex < contentLines.length &&
    contentLines[nextLineIndex].trim().length === 0
  ) {
    nextLineIndex += 1;
  }

  return contentLines.slice(nextLineIndex).join("\n");
}

function splitMdxFrontmatter(rawPost: string, filePath: string): { content: string; data: unknown } {
  const frontmatterMatch = rawPost.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);

  if (!frontmatterMatch) {
    throw new Error(`Blog post "${filePath}" must start with a YAML frontmatter block.`);
  }

  const frontmatterBlock = frontmatterMatch[1];
  let parsedFrontmatter: unknown;

  try {
    parsedFrontmatter = parseYaml(frontmatterBlock);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown YAML parse error";
    throw new Error(`Blog frontmatter parsing failed for "${filePath}": ${errorMessage}`);
  }

  return {
    content: rawPost.slice(frontmatterMatch[0].length).trimStart(),
    data: parsedFrontmatter ?? {},
  };
}

function formatRawPost(rawPost: string, filePath: string): Omit<BlogPost, "slug"> {
  const parsedPost = splitMdxFrontmatter(rawPost, filePath);
  const metadata = parseMetadata(parsedPost.data, filePath);
  return {
    content: removeRedundantLeadingHeading(parsedPost.content, metadata.title),
    metadata,
  };
}

function assignSlugs(posts: Omit<BlogPost, "slug">[]): BlogPost[] {
  const slugCounts = new Map<string, number>();
  return posts.map((post) => {
    const metadataSlug = post.metadata.slug;
    const hasCustomSlug = typeof metadataSlug === "string";
    const baseSlug = hasCustomSlug ? metadataSlug : createSlug(post.metadata.title);
    const seenCount = slugCounts.get(baseSlug) ?? 0;

    if (hasCustomSlug && seenCount > 0) {
      throw new Error(`Duplicate blog slug "${baseSlug}" found in metadata.`);
    }

    const nextCount = seenCount + 1;
    slugCounts.set(baseSlug, nextCount);

    const slug = seenCount === 0 ? baseSlug : `${baseSlug}-${nextCount}`;
    return {
      ...post,
      slug,
    };
  });
}

interface RawPostFile {
  filePath: string;
  rawContent: string;
}

function collectRawPosts(postModules: Record<string, unknown>): RawPostFile[] {
  return Object
    .entries(postModules)
    .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
    .map(([filePath, postModule]) => {
      if (typeof postModule !== "string") {
        throw new Error(`Blog post "${filePath}" must resolve to a raw string.`);
      }

      return {
        filePath,
        rawContent: postModule,
      };
    });
}

const rawPostModules = import.meta.glob("../content/blog/*.mdx", {
  eager: true,
  import: "default",
  query: "?raw",
});

const rawPosts = collectRawPosts(rawPostModules);

export const blogPosts = assignSlugs(rawPosts.map((rawPost) =>
  formatRawPost(rawPost.rawContent, rawPost.filePath),
)).sort((leftPost, rightPost) =>
  rightPost.metadata.createdAt.localeCompare(leftPost.metadata.createdAt),
);

export function findBlogPostBySlug(slug: string): BlogPost | undefined {
  return blogPosts.find((blogPost) => blogPost.slug === slug);
}

export function formatIsoDate(isoDate: string): string {
  const [yearPart, monthPart, dayPart] = isoDate.split("-");
  const monthName = monthNames[Number(monthPart) - 1];
  return `${monthName} ${Number(dayPart)}, ${yearPart}`;
}
