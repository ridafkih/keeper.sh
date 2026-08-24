import { describe, expect, it } from "vitest";

// eslint-disable-next-line @eslint/require-await
const readPackageManifest = async (): Promise<{
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}> => Bun.file(`${import.meta.dirname}/../../package.json`).json();

describe("@keeper.sh/database workspace graph", () => {
  it("never depends on the packages that depend on it", async () => {
    const manifest = await readPackageManifest();
    const declared = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    });

    expect(declared).not.toContain("@keeper.sh/calendar");
    expect(declared).not.toContain("@keeper.sh/sync");
  });

  it("keeps its leaf schema dependency", async () => {
    const manifest = await readPackageManifest();

    expect(Object.keys(manifest.dependencies ?? {})).toContain("@keeper.sh/data-schemas");
  });
});
