import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import type { BlogPost } from "../../src/lib/blog-posts";

const { blogPosts } = vi.hoisted(() => ({
  blogPosts: ["first", "second", "third", "fourth", "fifth"].map((slug, index) => ({
    content: "",
    faq: [],
    metadata: {
      blurb: `The ${slug} post.`,
      createdAt: `2026-08-0${5 - index}`,
      description: `The ${slug} post.`,
      tags: ["calendar"],
      title: `The ${slug} post`,
      updatedAt: `2026-08-0${5 - index}`,
    },
    slug,
  })) satisfies BlogPost[],
}));

vi.mock("../../src/lib/blog-posts", () => ({
  blogPosts,
  findBlogPostBySlug: (slug: string) => blogPosts.find((blogPost) => blogPost.slug === slug),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    children,
    params,
    to,
  }: {
    children: React.ReactNode;
    params?: { slug: string };
    to: string;
  }) => <a href={params ? to.replace("$slug", params.slug) : to}>{children}</a>,
}));

import { MarketingNotFound } from "../../src/features/marketing/components/marketing-not-found";
import { Route as NotFoundRoute } from "../../src/routes/(marketing)/$";
import { Route as BlogPostRoute } from "../../src/routes/(marketing)/blog/$slug";

const ROUTE_TREE_FILE = resolve(
  fileURLToPath(import.meta.url),
  "../../../src/generated/tanstack/route-tree.generated.ts",
);

type HeadRoute = {
  options: {
    head: (context: { params: Record<string, string> }) => {
      links?: Array<Record<string, string>>;
      meta?: Array<Record<string, string>>;
    };
  };
};

function headOf(route: unknown, params: Record<string, string> = {}) {
  return (route as HeadRoute).options.head({ params });
}

describe("the not-found route", () => {
  it("catches unmatched marketing paths in the generated route tree", () => {
    expect(readFileSync(ROUTE_TREE_FILE, "utf-8")).toContain("'/(marketing)/$'");
  });

  it("names the page instead of leaving the root title", () => {
    expect(headOf(NotFoundRoute).meta).toEqual([{ title: "Page not found · Keeper.sh" }]);
  });

  it("gives a missing blog post the same title", () => {
    expect(headOf(BlogPostRoute, { slug: "no-such-post" }).meta).toEqual([
      { title: "Page not found · Keeper.sh" },
    ]);
  });

  it("does not point search engines at the missing page", () => {
    expect(headOf(NotFoundRoute).links).toBeUndefined();
  });
});

describe("the not-found page", () => {
  const { document } = parseHTML(`<body>${renderToStaticMarkup(<MarketingNotFound />)}</body>`);

  it("leads with the page heading", () => {
    expect(document.querySelector("h1")?.textContent).toBe("Page not found");
  });

  it("stays out of the index", () => {
    expect(document.querySelector("meta[name='robots']")?.getAttribute("content")).toBe("noindex");
  });

  it("routes onward to the blog and its latest posts", () => {
    const hrefs = [...document.querySelectorAll("a")].map((link) => link.getAttribute("href"));

    expect(hrefs).toEqual([
      "/",
      "/blog",
      "/blog/first",
      "/blog/second",
      "/blog/third",
      "/blog/fourth",
    ]);
  });
});
