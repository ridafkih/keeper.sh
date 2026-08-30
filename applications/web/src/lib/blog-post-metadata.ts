import { type } from "arktype";

const OPEN_GRAPH_IMAGE_PATH =
  /^\/open-graph\/[a-z0-9]+(?:-[a-z0-9]+)*\.png$/;

export const blogPostMetadataSchema = type({
  "+": "reject",
  blurb: "string >= 1",
  createdAt: "string.date.iso",
  description: "string >= 1",
  "homepage?": "boolean",
  "homepagePin?": "boolean",
  "image?": OPEN_GRAPH_IMAGE_PATH,
  "replaces?": "string[]",
  "slug?": /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  tags: "string[]",
  title: "string >= 1",
  updatedAt: "string.date.iso",
});

export type BlogPostMetadata = typeof blogPostMetadataSchema.infer;

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

export function parseMetadata(value: unknown, filePath: string): BlogPostMetadata {
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
