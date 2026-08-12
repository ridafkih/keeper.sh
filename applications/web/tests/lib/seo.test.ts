import { describe, expect, it } from "vitest";
import { blogPostingSchema, seoMeta } from "@/lib/seo";

const GENERIC_IMAGE_URL = "https://www.keeper.sh/open-graph.png";

const post = {
  title: "How Calendar Sync Actually Works",
  description: "A long-form explainer.",
  slug: "how-calendar-sync-actually-works",
  createdAt: "2026-08-01",
  updatedAt: "2026-08-02",
  tags: ["calendar"],
};

function findMeta(meta: ReturnType<typeof seoMeta>, key: string) {
  return meta.find((entry) => "property" in entry && entry.property === key
    || "name" in entry && entry.name === key);
}

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
});
