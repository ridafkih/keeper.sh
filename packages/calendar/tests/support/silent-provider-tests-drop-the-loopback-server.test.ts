import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "../..");

const silentProviderTestFiles = [
  "tests/core/source/push-registrar-context-request-deadline.test.ts",
  "tests/providers/google/source/utils/calendar-listing-bounds-each-page-with-a-default-timeout.test.ts",
  "tests/providers/outlook/source/utils/calendar-listing-bounds-each-page-with-a-default-timeout.test.ts",
];

const sourceOf = async (relativePath: string) => {
  const file = Bun.file(resolve(packageRoot, relativePath));
  if (!(await file.exists())) {
    throw new Error(`silent-provider test file is missing: ${relativePath}`);
  }
  return await file.text();
};

describe("silent provider tests drop the loopback server", () => {
  it.each(silentProviderTestFiles)(
    "%s drives the silent provider through a fetch double rather than Bun.serve",
    async (relativePath) => {
      const source = await sourceOf(relativePath);

      expect(source).not.toContain("Bun.serve");
    },
  );

  it("names every test file that models a silent provider", async () => {
    const sources = await Promise.all(silentProviderTestFiles.map((relativePath) => sourceOf(relativePath)));

    expect(sources).toHaveLength(3);
    for (const source of sources) {
      expect(source).not.toContain("server.stop");
      expect(source).not.toContain("stalled.stop");
    }
  });
});
