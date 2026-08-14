import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CONTENT_DIRECTORIES = ["blog", "compare"].map((collection) =>
  join(import.meta.dirname, "../../src/content", collection),
);
const ABSOLUTE_SELF_LINK = /]\(https?:\/\/(?:www\.)?keeper\.sh(?![\w.-])[^)]*\)/g;

const posts = CONTENT_DIRECTORIES.flatMap((directory) =>
  readdirSync(directory)
    .filter((entry) => entry.endsWith(".mdx"))
    .map((entry) => join(directory, entry)),
);

describe("content links", () => {
  it("has posts to check", () => {
    expect(posts.length).toBeGreaterThan(0);
  });

  it.each(posts)("links to keeper.sh with root-relative paths in %s", (post) => {
    const content = readFileSync(post, "utf8");

    expect(content.match(ABSOLUTE_SELF_LINK)).toBeNull();
  });
});
