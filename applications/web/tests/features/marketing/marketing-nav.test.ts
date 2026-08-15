import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/features/marketing/components/nav-items";
import { changelogPaths, changelogReleases } from "@/lib/changelog";

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
  it("leads with the hub and gives every release its own path", () => {
    expect(changelogPaths[0]).toBe("/changelog");
    expect(changelogPaths).toEqual([
      "/changelog",
      ...changelogReleases.map((release) => `/changelog/${release.slug}`),
    ]);
  });

  it("lists each path once", () => {
    expect(new Set(changelogPaths).size).toBe(changelogPaths.length);
  });
});

describe("changelogReleases", () => {
  it("runs newest first", () => {
    const slugs = changelogReleases.map((release) => release.slug);
    expect(slugs).toEqual([...slugs].sort().reverse());
  });

  it("writes every note as a full sentence, not an area-prefixed fragment", () => {
    for (const release of changelogReleases) {
      const notes = [...release.features, ...release.improvements, ...release.fixes];

      for (const note of notes) {
        expect(note).toMatch(/\.$/);
        expect(note).not.toMatch(/^[A-Za-z ]+ — /);
        expect(note.split(" ").length).toBeGreaterThan(3);
      }
    }
  });

  it("gives every release the prose and metadata its page renders", () => {
    for (const release of changelogReleases) {
      expect(release.title.length).toBeGreaterThan(0);
      expect(release.description.length).toBeGreaterThan(0);
      expect(release.build.length).toBeGreaterThan(0);
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(release.content.length).toBeGreaterThan(0);
    }
  });
});
