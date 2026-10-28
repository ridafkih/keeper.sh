import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlogPost } from "../../src/lib/blog-posts";

const { blogPost } = vi.hoisted(() => ({
  blogPost: {
    content: "Read [the docs](/docs).",
    faq: [],
    metadata: {
      blurb: "Blurb.",
      createdAt: "2026-10-01",
      description: "How sync works.",
      tags: [],
      title: "How sync works",
      updatedAt: "2026-10-02",
    },
    slug: "how-sync-works",
  } satisfies BlogPost,
}));

vi.mock("../../src/lib/blog-posts", () => ({ blogPosts: [blogPost] }));

import { renderMarkdownPage } from "../../src/lib/markdown-pages";

describe("renderMarkdownPage", () => {
  beforeEach(() => {
    vi.stubEnv("COMMERCIAL_MODE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the prepared document for a content page", () => {
    expect(renderMarkdownPage("/blog/how-sync-works")).toContain(
      "# How sync works\n\n> How sync works.\n\nRead [the docs](https://www.keeper.sh/docs).",
    );
  });

  it("only matches exact content page paths", () => {
    for (const path of [
      "/blog/How-Sync-Works",
      "/blog/how-sync-works/",
      "/blog/how-sync-works.md",
      "/blog/../blog/how-sync-works",
      "/blog/how-sync-works%3E;rel=x",
      "/blog",
      "/blog/",
    ]) {
      expect(renderMarkdownPage(path)).toBeNull();
    }
  });

  it("serves nothing where the marketing site is turned off", () => {
    vi.stubEnv("COMMERCIAL_MODE", "false");
    expect(renderMarkdownPage("/blog/how-sync-works")).toBeNull();
  });
});
