import { describe, expect, it } from "vitest";
import { parseMetadata } from "@/lib/blog-post-metadata";

const REQUIRED_FRONTMATTER = {
  blurb: "A short blurb.",
  createdAt: "2026-08-01",
  description: "A longer description.",
  tags: ["calendar"],
  title: "Fixture Post",
  updatedAt: "2026-08-01",
};

describe("parseMetadata homepage fields", () => {
  it("keeps homepage and homepagePin when they are set", () => {
    const metadata = parseMetadata(
      {
        ...REQUIRED_FRONTMATTER,
        homepage: false,
        homepagePin: true,
      },
      "fixture-post.mdx",
    );

    expect(metadata.homepage).toBe(false);
    expect(metadata.homepagePin).toBe(true);
  });

  it("omits homepage fields when they are missing", () => {
    const metadata = parseMetadata(REQUIRED_FRONTMATTER, "fixture-post.mdx");

    expect(metadata.homepage).toBeUndefined();
    expect(metadata.homepagePin).toBeUndefined();
  });

  it("still rejects unknown frontmatter keys", () => {
    expect(() =>
      parseMetadata(
        {
          ...REQUIRED_FRONTMATTER,
          featured: true,
        },
        "fixture-post.mdx",
      ),
    ).toThrow(/Blog metadata is invalid/);
  });
});
