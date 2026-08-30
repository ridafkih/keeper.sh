import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { processBlogDirectory } from "../../plugins/blog";

const REQUIRED_FRONTMATTER = `blurb: A short blurb.
createdAt: 2026-08-01
description: A longer description.
tags:
  - calendar
title: Fixture Post
updatedAt: 2026-08-01`;

let fixtureRoot: string | undefined;

afterEach(() => {
  if (fixtureRoot === undefined) return;
  rmSync(fixtureRoot, { force: true, recursive: true });
  fixtureRoot = undefined;
});

function writeFixture(frontmatter: string, filename = "fixture-post.mdx"): string {
  fixtureRoot = mkdtempSync(join(tmpdir(), "keeper-blog-"));
  writeFileSync(join(fixtureRoot, filename), `---\n${frontmatter}\n---\n\nBody.\n`);
  return fixtureRoot;
}

describe("processBlogDirectory homepage metadata", () => {
  it("keeps homepage and homepagePin when they are set", () => {
    const directory = writeFixture(`${REQUIRED_FRONTMATTER}
homepage: false
homepagePin: true
slug: fixture-post`);

    const [post] = processBlogDirectory(directory, directory);

    expect(post?.metadata.homepage).toBe(false);
    expect(post?.metadata.homepagePin).toBe(true);
  });

  it("omits homepage fields when they are missing", () => {
    const directory = writeFixture(`${REQUIRED_FRONTMATTER}
slug: fixture-post`);

    const [post] = processBlogDirectory(directory, directory);

    expect(post?.metadata.homepage).toBeUndefined();
    expect(post?.metadata.homepagePin).toBeUndefined();
  });

  it("still rejects unknown frontmatter keys", () => {
    const directory = writeFixture(`${REQUIRED_FRONTMATTER}
featured: true
slug: fixture-post`);

    expect(() => processBlogDirectory(directory, directory)).toThrow(
      /Blog metadata is invalid/,
    );
  });
});
