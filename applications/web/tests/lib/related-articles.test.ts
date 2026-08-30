import { describe, expect, it } from "vitest";
import {
  selectHomepageLatestArticles,
  selectLatestArticles,
  selectRelatedArticles,
  type ArticleSummary,
} from "@/lib/related-articles";

const articles: ArticleSummary[] = [
  {
    blurb: "How Keeper.sh and CalendarBridge differ.",
    createdAt: "2026-08-11",
    path: "/compare/calendarbridge-alternative",
    tags: ["calendar", "comparison", "calendarbridge"],
    title: "CalendarBridge Alternative",
  },
  {
    blurb: "How Keeper.sh and OneCal differ.",
    createdAt: "2026-08-10",
    path: "/compare/onecal-alternative",
    tags: ["calendar", "comparison", "onecal"],
    title: "OneCal Alternative",
  },
  {
    blurb: "Why syncing calendars is harder than it looks.",
    createdAt: "2026-08-09",
    path: "/blog/how-calendar-sync-actually-works",
    tags: ["calendar", "engineering"],
    title: "How Calendar Sync Actually Works",
  },
  {
    blurb: "Connecting Google Calendar to Outlook.",
    createdAt: "2026-08-08",
    path: "/blog/how-to-sync-google-calendar-with-outlook",
    tags: ["google", "outlook"],
    title: "How To Sync Google Calendar With Outlook",
  },
];

describe("selectRelatedArticles", () => {
  it("leaves the current article out of its own suggestions", () => {
    const related = selectRelatedArticles("/compare/calendarbridge-alternative", articles);

    expect(related.map((article) => article.path)).not.toContain(
      "/compare/calendarbridge-alternative",
    );
  });

  it("puts the articles sharing the most tags first", () => {
    const related = selectRelatedArticles("/compare/calendarbridge-alternative", articles);

    expect(related.map((article) => article.path)).toEqual([
      "/compare/onecal-alternative",
      "/blog/how-calendar-sync-actually-works",
      "/blog/how-to-sync-google-calendar-with-outlook",
    ]);
  });

  it("falls back to the newest articles for a path outside the library", () => {
    const related = selectRelatedArticles("/compare/unknown", articles, 2);

    expect(related.map((article) => article.path)).toEqual([
      "/compare/calendarbridge-alternative",
      "/compare/onecal-alternative",
    ]);
  });
});

describe("selectLatestArticles", () => {
  it("returns the newest articles first without mutating the library", () => {
    const latest = selectLatestArticles([...articles].reverse(), 2);

    expect(latest.map((article) => article.path)).toEqual([
      "/compare/calendarbridge-alternative",
      "/compare/onecal-alternative",
    ]);
    expect(articles[0].path).toBe("/compare/calendarbridge-alternative");
  });
});

function summary(
  path: string,
  createdAt: string,
  fields: Pick<ArticleSummary, "homepage" | "homepagePin" | "tags"> = {},
): ArticleSummary {
  return {
    blurb: path,
    createdAt,
    path,
    tags: fields.tags ?? [],
    title: path,
    ...fields,
  };
}

const recencyLibrary: ArticleSummary[] = [
  summary("/blog/alpha", "2026-08-16"),
  summary("/blog/bravo", "2026-08-15"),
  summary("/blog/charlie", "2026-08-14"),
  summary("/blog/delta", "2026-08-13"),
  summary("/blog/echo", "2026-08-12"),
  summary("/blog/foxtrot", "2026-08-11"),
  summary("/blog/golf", "2026-08-10"),
  summary("/compare/rival-alternative", "2026-08-18"),
];

describe("selectHomepageLatestArticles", () => {
  it("keeps recency among posts when homepage fields are missing", () => {
    const latest = selectHomepageLatestArticles(recencyLibrary, 6);

    expect(latest.map((article) => article.path)).toEqual([
      "/blog/alpha",
      "/blog/bravo",
      "/blog/charlie",
      "/blog/delta",
      "/blog/echo",
      "/blog/foxtrot",
    ]);
  });

  it("still excludes compare paths from the homepage roll", () => {
    const latest = selectHomepageLatestArticles(recencyLibrary, 6);

    expect(latest.map((article) => article.path)).not.toContain(
      "/compare/rival-alternative",
    );
  });

  it("drops a post when homepage is false", () => {
    const latest = selectHomepageLatestArticles(
      [
        summary("/blog/alpha", "2026-08-16", { homepage: false }),
        summary("/blog/bravo", "2026-08-15"),
        summary("/blog/charlie", "2026-08-14"),
        summary("/blog/delta", "2026-08-13"),
        summary("/blog/echo", "2026-08-12"),
        summary("/blog/foxtrot", "2026-08-11"),
        summary("/blog/golf", "2026-08-10"),
      ],
      6,
    );

    expect(latest.map((article) => article.path)).toEqual([
      "/blog/bravo",
      "/blog/charlie",
      "/blog/delta",
      "/blog/echo",
      "/blog/foxtrot",
      "/blog/golf",
    ]);
  });

  it("promotes an eligible pinned post in place of the oldest unpinned item", () => {
    const latest = selectHomepageLatestArticles(
      [
        summary("/blog/alpha", "2026-08-16"),
        summary("/blog/bravo", "2026-08-15"),
        summary("/blog/charlie", "2026-08-14"),
        summary("/blog/delta", "2026-08-13"),
        summary("/blog/echo", "2026-08-12"),
        summary("/blog/foxtrot", "2026-08-11"),
        summary("/blog/golf", "2026-08-10", { homepagePin: true }),
      ],
      6,
    );

    expect(latest.map((article) => article.path)).toEqual([
      "/blog/alpha",
      "/blog/bravo",
      "/blog/charlie",
      "/blog/delta",
      "/blog/echo",
      "/blog/golf",
    ]);
  });

  it("leaves a pinned post in place when it already ranks by recency", () => {
    const latest = selectHomepageLatestArticles(
      [
        summary("/blog/alpha", "2026-08-16", { homepagePin: true }),
        summary("/blog/bravo", "2026-08-15"),
        summary("/blog/charlie", "2026-08-14"),
        summary("/blog/delta", "2026-08-13"),
      ],
      3,
    );

    expect(latest.map((article) => article.path)).toEqual([
      "/blog/alpha",
      "/blog/bravo",
      "/blog/charlie",
    ]);
  });

  it("keeps the newest pins when more posts are pinned than the roll allows", () => {
    const latest = selectHomepageLatestArticles(
      [
        summary("/blog/alpha", "2026-08-16"),
        summary("/blog/bravo", "2026-08-15", { homepagePin: true }),
        summary("/blog/charlie", "2026-08-14", { homepagePin: true }),
        summary("/blog/delta", "2026-08-13", { homepagePin: true }),
        summary("/blog/echo", "2026-08-12", { homepagePin: true }),
      ],
      3,
    );

    expect(latest.map((article) => article.path)).toEqual([
      "/blog/bravo",
      "/blog/charlie",
      "/blog/delta",
    ]);
  });

  it("does not promote a pinned post that is excluded from the homepage", () => {
    const latest = selectHomepageLatestArticles(
      [
        summary("/blog/alpha", "2026-08-16"),
        summary("/blog/bravo", "2026-08-15"),
        summary("/blog/golf", "2026-08-10", { homepage: false, homepagePin: true }),
      ],
      2,
    );

    expect(latest.map((article) => article.path)).toEqual([
      "/blog/alpha",
      "/blog/bravo",
    ]);
  });

  it("does not mutate the library", () => {
    const originalOrder = recencyLibrary.map((article) => article.path);
    selectHomepageLatestArticles(recencyLibrary, 6);
    expect(recencyLibrary.map((article) => article.path)).toEqual(originalOrder);
  });
});
