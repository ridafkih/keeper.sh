import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/features/marketing/components/nav-items";
import { changelogFeatures, changelogPaths, changelogReleases } from "@/lib/changelog";

describe("NAV_ITEMS", () => {
  it("keeps the header to the pages someone deciding whether to buy needs", () => {
    expect(NAV_ITEMS.map((item) => item.to)).toEqual([
      "/features",
      "/pricing",
      "/changelog",
    ]);
  });

  it("keeps support content out of the header", () => {
    const labels = NAV_ITEMS.map((item) => item.label);
    expect(labels).not.toContain("Docs");
    expect(labels).not.toContain("Guides");
    expect(labels).not.toContain("Recipes");
  });
});

describe("changelogPaths", () => {
  it("leads with the hub and gives every featured entry its own path", () => {
    expect(changelogPaths[0]).toBe("/changelog");
    expect(changelogPaths.length).toBeGreaterThan(1);
    expect(new Set(changelogPaths).size).toBe(changelogPaths.length);
  });

  it("covers every featured entry, and every anchor on the hub is unique", () => {
    expect(changelogPaths).toEqual([
      "/changelog",
      ...changelogFeatures.map((feature) => `/changelog/${feature.slug}`),
    ]);

    const anchors = changelogReleases.flatMap((release) => [
      ...release.features.map((feature) => feature.slug),
      ...[...release.added, ...release.improved, ...release.fixed].map((note) => note.id),
    ]);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(anchors.every((anchor) => /^[a-z0-9-]+$/.test(anchor))).toBe(true);
  });
});
