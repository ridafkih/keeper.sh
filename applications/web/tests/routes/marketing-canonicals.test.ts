import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { BlogPost } from "../../src/lib/blog-posts";
import { parseIndexableRoutePaths } from "../../src/lib/indexable-routes";
import { canonicalUrl } from "../../src/lib/seo";

const { blogPost } = vi.hoisted(() => ({
  blogPost: {
    content: "",
    faq: [],
    metadata: {
      blurb: "How syncing works.",
      createdAt: "2026-08-01",
      description: "A long-form explainer.",
      tags: ["calendar"],
      title: "How Calendar Sync Actually Works",
      updatedAt: "2026-08-02",
    },
    slug: "how-calendar-sync-actually-works",
  } satisfies BlogPost,
}));

vi.mock("../../src/lib/blog-posts", () => ({
  blogPosts: [blogPost],
  findBlogPostBySlug: (slug: string) => (slug === blogPost.slug ? blogPost : undefined),
}));

import { Route as HomeRoute } from "../../src/routes/(marketing)/index";
import { Route as FeaturesRoute } from "../../src/routes/(marketing)/features";
import { Route as PricingRoute } from "../../src/routes/(marketing)/pricing";
import { Route as PrivacyRoute } from "../../src/routes/(marketing)/privacy";
import { Route as TermsRoute } from "../../src/routes/(marketing)/terms";
import { Route as BlogIndexRoute } from "../../src/routes/(marketing)/blog/index";
import { Route as BlogPostRoute } from "../../src/routes/(marketing)/blog/$slug";
import { Route as McpDocsRoute } from "../../src/routes/(marketing)/docs/mcp";
import { Route as AboutRoute } from "../../src/routes/(marketing)/about";
import { Route as SelfHostingRoute } from "../../src/routes/(marketing)/self-hosting";
import { Route as IcsGeneratorRoute } from "../../src/routes/(marketing)/tools/ics-generator";
import { Route as IcsViewerRoute } from "../../src/routes/(marketing)/tools/ics-viewer";
import { Route as CompareIndexRoute } from "../../src/routes/(marketing)/compare/index";
import { Route as DocsIndexRoute } from "../../src/routes/(marketing)/docs/index";
import { Route as GuidesIndexRoute } from "../../src/routes/(marketing)/guides/index";
import { Route as RecipesIndexRoute } from "../../src/routes/(marketing)/recipes/index";

const ROUTE_TREE_FILE = resolve(
  fileURLToPath(import.meta.url),
  "../../../src/generated/tanstack/route-tree.generated.ts",
);

type HeadContext = { params: Record<string, string> };
type HeadRoute = {
  options: { head: (context: HeadContext) => { links?: Array<Record<string, string>> } };
};

const indexableRoutes: Record<string, HeadRoute> = {
  "/": HomeRoute as unknown as HeadRoute,
  "/about": AboutRoute as unknown as HeadRoute,
  "/blog": BlogIndexRoute as unknown as HeadRoute,
  "/compare": CompareIndexRoute as unknown as HeadRoute,
  "/docs": DocsIndexRoute as unknown as HeadRoute,
  "/docs/mcp": McpDocsRoute as unknown as HeadRoute,
  "/features": FeaturesRoute as unknown as HeadRoute,
  "/guides": GuidesIndexRoute as unknown as HeadRoute,
  "/pricing": PricingRoute as unknown as HeadRoute,
  "/privacy": PrivacyRoute as unknown as HeadRoute,
  "/recipes": RecipesIndexRoute as unknown as HeadRoute,
  "/self-hosting": SelfHostingRoute as unknown as HeadRoute,
  "/terms": TermsRoute as unknown as HeadRoute,
  "/tools/ics-generator": IcsGeneratorRoute as unknown as HeadRoute,
  "/tools/ics-viewer": IcsViewerRoute as unknown as HeadRoute,
};

function canonicalsOf(route: HeadRoute, params: Record<string, string> = {}): string[] {
  const { links = [] } = route.options.head({ params });
  return links.filter((link) => link.rel === "canonical").map((link) => link.href);
}

describe("marketing route canonicals", () => {
  it("cover every indexable route in the generated route tree", () => {
    const routePaths = parseIndexableRoutePaths(readFileSync(ROUTE_TREE_FILE, "utf-8"));

    expect(routePaths.length).toBeGreaterThan(0);
    expect(Object.keys(indexableRoutes).sort()).toEqual(routePaths);
  });

  it.each(Object.entries(indexableRoutes))(
    "are emitted exactly once, self-referencing, for %s",
    (path, route) => {
      expect(canonicalsOf(route)).toEqual([canonicalUrl(path)]);
    },
  );

  it("are emitted exactly once, self-referencing, for a blog post", () => {
    expect(canonicalsOf(BlogPostRoute as unknown as HeadRoute, { slug: blogPost.slug })).toEqual([
      canonicalUrl(`/blog/${blogPost.slug}`),
    ]);
  });
});
