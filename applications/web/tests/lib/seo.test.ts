import { describe, expect, it } from "vitest";
import {
  blogPostingSchema,
  canonicalUrl,
  collectionPageSchema,
  seoMeta,
  webPageSchema,
} from "@/lib/seo";

const GENERIC_IMAGE_URL = "https://www.keeper.sh/open-graph.png";

const post = {
  title: "How Calendar Sync Actually Works",
  description: "A long-form explainer.",
  path: "/blog/how-calendar-sync-actually-works",
  createdAt: "2026-08-01",
  updatedAt: "2026-08-02",
  tags: ["calendar"],
};

function findMeta(meta: ReturnType<typeof seoMeta>, key: string) {
  return meta.find((entry) => "property" in entry && entry.property === key
    || "name" in entry && entry.name === key);
}

describe("canonicalUrl", () => {
  it("keeps the trailing slash on the homepage", () => {
    expect(canonicalUrl("/")).toBe("https://www.keeper.sh/");
  });

  it("treats an empty path as the homepage", () => {
    expect(canonicalUrl("")).toBe("https://www.keeper.sh/");
  });

  it("preserves nested paths verbatim", () => {
    expect(canonicalUrl("/blog/why-keeper")).toBe("https://www.keeper.sh/blog/why-keeper");
    expect(canonicalUrl("/pricing/")).toBe("https://www.keeper.sh/pricing/");
  });

  it("collapses duplicate leading slashes", () => {
    expect(canonicalUrl("//pricing")).toBe("https://www.keeper.sh/pricing");
  });
});

describe("seoMeta", () => {
  it("falls back to the generic share image", () => {
    const meta = seoMeta({
      title: "Pricing",
      description: "Plans and pricing.",
      path: "/pricing",
    });

    expect(findMeta(meta, "og:image")).toEqual({
      content: GENERIC_IMAGE_URL,
      property: "og:image",
    });
    expect(findMeta(meta, "twitter:image")).toEqual({
      content: GENERIC_IMAGE_URL,
      name: "twitter:image",
    });
  });

  it("resolves a site-relative image path against the www host", () => {
    const meta = seoMeta({
      title: "Pricing",
      description: "Plans and pricing.",
      path: "/pricing",
      imagePath: "/open-graph/pricing.png",
    });

    expect(findMeta(meta, "og:image")).toEqual({
      content: "https://www.keeper.sh/open-graph/pricing.png",
      property: "og:image",
    });
    expect(findMeta(meta, "twitter:image")).toEqual({
      content: "https://www.keeper.sh/open-graph/pricing.png",
      name: "twitter:image",
    });
  });

  it("keeps the declared image dimensions at 1200x630", () => {
    const meta = seoMeta({
      title: "Pricing",
      description: "Plans and pricing.",
      path: "/pricing",
      imagePath: "/open-graph/pricing.png",
    });

    expect(findMeta(meta, "og:image:width")).toEqual({
      content: "1200",
      property: "og:image:width",
    });
    expect(findMeta(meta, "og:image:height")).toEqual({
      content: "630",
      property: "og:image:height",
    });
  });
});

describe("webPageSchema", () => {
  it("builds a fragment identifier without a double slash", () => {
    expect(webPageSchema("Home", "Home page", "/")["@id"]).toBe("https://www.keeper.sh/#webpage");
    expect(webPageSchema("Home", "Home page", "")["@id"]).toBe("https://www.keeper.sh/#webpage");
  });

  it("keeps the published identifier for nested pages", () => {
    const schema = webPageSchema("Privacy Policy", "Privacy policy", "/privacy");
    expect(schema["@id"]).toBe("https://www.keeper.sh/privacy/#webpage");
    expect(schema.url).toBe("https://www.keeper.sh/privacy");
  });
});

describe("blogPostingSchema", () => {
  it("falls back to the generic share image", () => {
    expect(blogPostingSchema(post).image).toBe(GENERIC_IMAGE_URL);
  });

  it("uses the post image when one is provided", () => {
    expect(
      blogPostingSchema({
        ...post,
        imagePath: "/open-graph/how-calendar-sync-actually-works.png",
      }).image,
    ).toBe(
      "https://www.keeper.sh/open-graph/how-calendar-sync-actually-works.png",
    );
  });

  it("keeps the published identifier", () => {
    const schema = blogPostingSchema({
      title: "Why Keeper",
      description: "A post",
      path: "/blog/why-keeper",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
      tags: ["calendar"],
    });
    expect(schema["@id"]).toBe("https://www.keeper.sh/blog/why-keeper/#blogposting");
    expect(schema.url).toBe("https://www.keeper.sh/blog/why-keeper");
  });
});

describe("collectionPageSchema", () => {
  it("keeps the published identifier", () => {
    expect(collectionPageSchema("/blog", "Blog", [])["@id"]).toBe(
      "https://www.keeper.sh/blog/#collectionpage",
    );
  });

  it("lists every entry under the collection it belongs to", () => {
    const schema = collectionPageSchema("/compare", "Compare", [
      { slug: "onecal-alternative", metadata: { title: "OneCal Alternative" } },
    ]);

    expect(schema.name).toBe("Compare");
    expect(schema.mainEntity.itemListElement[0].url).toBe(
      "https://www.keeper.sh/compare/onecal-alternative",
    );
  });
});
