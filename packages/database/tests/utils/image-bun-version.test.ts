import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

const DOCKERFILES = [
  "applications/web/Dockerfile",
  "docker/services/Dockerfile",
  "docker/standalone/Dockerfile",
  "services/api/Dockerfile",
  "services/cron/Dockerfile",
  "services/mcp/Dockerfile",
  "services/worker/Dockerfile",
];

const BUN_IMAGE_REFERENCE = /oven\/bun:(\S+)/g;
const PINNED_BUN_TAG = /^(\d+\.\d+\.\d+)@sha256:[0-9a-f]{64}$/;

const read = (path: string): string => readFileSync(join(REPOSITORY_ROOT, path), "utf8");

const readPackageManagerBunVersion = (): string => {
  const manifest: { packageManager?: string } = JSON.parse(read("package.json"));
  const match = manifest.packageManager?.match(/^bun@(\d+\.\d+\.\d+)$/);
  expect(match, "package.json names no exact Bun version in packageManager").not.toBeNull();
  return (match as RegExpMatchArray)[1] as string;
};

const readBunImageTags = (dockerfile: string): string[] =>
  [...read(dockerfile).matchAll(BUN_IMAGE_REFERENCE)].map((match) => match[1] as string);

describe.each(DOCKERFILES)("%s Bun runtime", (dockerfile) => {
  it("names an exact Bun version pinned by digest", () => {
    const tags = readBunImageTags(dockerfile);

    expect(tags.length, "the image is not built from oven/bun").toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag).toMatch(PINNED_BUN_TAG);
    }
  });

  it("runs the Bun version that packageManager installs for development and CI", () => {
    const versions = readBunImageTags(dockerfile).map((tag) => tag.split("@")[0]);

    expect(new Set(versions)).toEqual(new Set([readPackageManagerBunVersion()]));
  });
});
