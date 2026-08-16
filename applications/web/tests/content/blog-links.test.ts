import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEO_CONTENT_ROOT } from "../../src/lib/content-paths";

const CONTENT_DIRECTORIES = ["blog", "compare", "docs", "guides", "recipes"]
  .map((collection) => join(import.meta.dirname, "../..", SEO_CONTENT_ROOT, collection))
  .filter((directory) => existsSync(directory));
const ABSOLUTE_SELF_LINK = /]\(https?:\/\/(?:www\.)?keeper\.sh(?![\w.-])[^)]*\)/g;

const posts = CONTENT_DIRECTORIES.flatMap((directory) =>
  readdirSync(directory)
    .filter((entry) => entry.endsWith(".mdx"))
    .map((entry) => join(directory, entry)),
);


/* The `seo` submodule is optional: a clone without it still builds. These suites
 * assert against real files, so they are skipped rather than weakened — the
 * "has posts to check" guards must keep failing when content IS present but
 * empty. */
const CONTENT_PRESENT = existsSync(
  join(import.meta.dirname, "../..", SEO_CONTENT_ROOT, "blog"),
);

describe.skipIf(!CONTENT_PRESENT)("content links", () => {
  it("has posts to check", () => {
    expect(posts.length).toBeGreaterThan(0);
  });

  it.each(posts)("links to keeper.sh with root-relative paths in %s", (post) => {
    const content = readFileSync(post, "utf8");

    expect(content.match(ABSOLUTE_SELF_LINK)).toBeNull();
  });
});
