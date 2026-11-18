import { describe, expect, it } from "vitest";
import { resolveCompareHubGroups } from "@/features/marketing/compare-hub";

const page = (slug: string) => ({ slug, metadata: { title: `Title of ${slug}`, blurb: `Blurb of ${slug}` } });

const collections = {
  blog: [page("stop-calendly-double-booking")],
  compare: [page("onecal-alternative"), page("syncdate-alternative")],
};

describe("resolveCompareHubGroups", () => {
  it("shows each named article under its group with the copy's label and the page's blurb", () => {
    const { groups, ungrouped } = resolveCompareHubGroups(
      [
        {
          heading: "Calendar sync services",
          links: [
            { label: "SyncDate alternative", path: "/compare/syncdate-alternative" },
            { label: "OneCal alternative", path: "/compare/onecal-alternative" },
          ],
        },
        {
          heading: "Booking tools",
          links: [{ label: "How to stop Calendly double-booking", path: "/blog/stop-calendly-double-booking" }],
        },
      ],
      collections,
    );

    expect(groups).toEqual([
      {
        heading: "Calendar sync services",
        articles: [
          { path: "/compare/syncdate-alternative", title: "SyncDate alternative", blurb: "Blurb of syncdate-alternative" },
          { path: "/compare/onecal-alternative", title: "OneCal alternative", blurb: "Blurb of onecal-alternative" },
        ],
      },
      {
        heading: "Booking tools",
        articles: [
          {
            path: "/blog/stop-calendly-double-booking",
            title: "How to stop Calendly double-booking",
            blurb: "Blurb of stop-calendly-double-booking",
          },
        ],
      },
    ]);
    expect(ungrouped).toEqual([]);
  });

  it("leaves out an article that is not published, and a group with none left", () => {
    const { groups } = resolveCompareHubGroups(
      [
        {
          heading: "Calendar sync services",
          links: [
            { label: "OneCal alternative", path: "/compare/onecal-alternative" },
            { label: "Morgen alternative", path: "/compare/morgen-alternative" },
          ],
        },
        { heading: "Desktop tools", links: [{ label: "OGCS alternative", path: "/compare/ogcs-alternative" }] },
      ],
      collections,
    );

    expect(groups.map((group) => group.heading)).toEqual(["Calendar sync services"]);
    expect(groups[0]?.articles.map((article) => article.path)).toEqual(["/compare/onecal-alternative"]);
  });

  it("returns every compare page that no group names, under its own title", () => {
    const { ungrouped } = resolveCompareHubGroups(
      [{ heading: "Calendar sync services", links: [{ label: "OneCal alternative", path: "/compare/onecal-alternative" }] }],
      collections,
    );

    expect(ungrouped).toEqual([
      { path: "/compare/syncdate-alternative", title: "Title of syncdate-alternative", blurb: "Blurb of syncdate-alternative" },
    ]);
  });

  it("lists every compare page when the copy has no groups", () => {
    const { groups, ungrouped } = resolveCompareHubGroups([], collections);

    expect(groups).toEqual([]);
    expect(ungrouped.map((article) => article.path)).toEqual([
      "/compare/onecal-alternative",
      "/compare/syncdate-alternative",
    ]);
  });
});
