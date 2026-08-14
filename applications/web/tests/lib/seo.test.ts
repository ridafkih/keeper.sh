import { describe, expect, it } from "vitest";
import {
  blogPostingSchema,
  canonicalUrl,
  collectionPageSchema,
  organizationSchema,
  personSchema,
  seoMeta,
  webPageSchema,
} from "@/lib/seo";

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
      slug: "why-keeper",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
      tags: ["calendar"],
    });
    expect(schema["@id"]).toBe("https://www.keeper.sh/blog/why-keeper/#blogposting");
    expect(schema.url).toBe("https://www.keeper.sh/blog/why-keeper");
  });
});

describe("personSchema", () => {
  const PERSON_ID = "https://www.keeper.sh/about/#person";

  it("is identified by the about page", () => {
    const schema = personSchema("The maintainer.");
    expect(schema["@id"]).toBe(PERSON_ID);
    expect(schema.url).toBe("https://www.keeper.sh/about");
    expect(schema.mainEntityOfPage).toEqual({ "@id": "https://www.keeper.sh/about/#webpage" });
  });

  it("claims both author profiles", () => {
    expect(personSchema("The maintainer.").sameAs).toEqual([
      "https://github.com/ridafkih",
      "https://rida.dev",
    ]);
  });

  it("is the author a blog post points at and the organization's founder", () => {
    const reference = { "@id": PERSON_ID, "@type": "Person", name: "Rida F'kih" };

    expect(blogPostingSchema(post).author).toEqual(reference);
    expect(organizationSchema["@graph"][0]).toMatchObject({ founder: reference });
  });

  it("names the person everywhere it is referenced, because the node itself is only on /about", () => {
    const { author } = blogPostingSchema(post);

    expect(author["@type"]).toBe("Person");
    expect(author.name).toBe(personSchema("The maintainer.").name);
  });
});

describe("collectionPageSchema", () => {
  it("keeps the published identifier", () => {
    expect(collectionPageSchema([])["@id"]).toBe("https://www.keeper.sh/blog/#collectionpage");
  });
});
