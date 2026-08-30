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

function summary(path: string, createdAt: string, tags: string[] = []): ArticleSummary {
  return {
    blurb: path,
    createdAt,
    path,
    tags,
    title: path,
  };
}

const homepageLibrary: ArticleSummary[] = [
  summary("/blog/how-to-give-claude-access-to-your-calendar-mcp", "2026-08-20", ["mcp"]),
  summary("/blog/what-an-ai-agent-can-do-with-your-calendar", "2026-08-19", ["mcp"]),
  summary("/compare/calendarbridge-alternative", "2026-08-18", ["comparison"]),
  summary("/blog/how-to-sync-google-calendar-with-outlook", "2026-08-17"),
  summary("/blog/how-to-sync-icloud-calendar-with-google", "2026-08-16"),
  summary("/blog/how-to-block-time-on-another-calendar", "2026-08-15"),
  summary("/blog/how-to-sync-outlook-with-icloud", "2026-08-14"),
  summary("/blog/how-to-keep-two-calendars-busy", "2026-08-13"),
  summary("/blog/how-to-sync-google-calendar-with-icloud", "2026-08-12"),
  summary("/blog/sync-fastmail-calendar-with-google-calendar", "2026-08-11"),
  summary("/blog/sync-fastmail-calendar-with-outlook", "2026-08-09"),
  summary("/docs/mcp", "2026-08-21", ["docs"]),
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

describe("selectHomepageLatestArticles", () => {
  it("keeps six newest non-MCP blog posts and promotes Fastmail when missing", () => {
    const latest = selectHomepageLatestArticles(homepageLibrary, 6);

    expect(latest.map((article) => article.path)).toEqual([
      "/blog/how-to-sync-google-calendar-with-outlook",
      "/blog/how-to-sync-icloud-calendar-with-google",
      "/blog/how-to-block-time-on-another-calendar",
      "/blog/how-to-sync-outlook-with-icloud",
      "/blog/how-to-keep-two-calendars-busy",
      "/blog/sync-fastmail-calendar-with-google-calendar",
    ]);
  });

  it("keeps MCP funnel posts, compare pages, and /docs/mcp off the roll", () => {
    const latest = selectHomepageLatestArticles(homepageLibrary, 6);
    const paths = latest.map((article) => article.path);

    expect(paths).not.toContain("/blog/how-to-give-claude-access-to-your-calendar-mcp");
    expect(paths).not.toContain("/blog/what-an-ai-agent-can-do-with-your-calendar");
    expect(paths).not.toContain("/compare/calendarbridge-alternative");
    expect(paths).not.toContain("/docs/mcp");
  });

  it("excludes future blog paths that contain mcp or claude", () => {
    const latest = selectHomepageLatestArticles(
      [
        summary("/blog/future-mcp-calendar-guide", "2026-08-22"),
        summary("/blog/connect-claude-to-your-calendar", "2026-08-21"),
        summary("/blog/how-to-sync-google-calendar-with-outlook", "2026-08-17"),
      ],
      6,
    );

    expect(latest.map((article) => article.path)).toEqual([
      "/blog/how-to-sync-google-calendar-with-outlook",
    ]);
  });

  it("leaves Fastmail in place when it already ranks in the newest posts", () => {
    const latest = selectHomepageLatestArticles(
      [
        summary("/blog/sync-fastmail-calendar-with-google-calendar", "2026-08-18"),
        summary("/blog/how-to-sync-google-calendar-with-outlook", "2026-08-17"),
        summary("/blog/how-to-sync-icloud-calendar-with-google", "2026-08-16"),
        summary("/blog/older-busy-block-guide", "2026-08-10"),
      ],
      3,
    );

    expect(latest.map((article) => article.path)).toEqual([
      "/blog/sync-fastmail-calendar-with-google-calendar",
      "/blog/how-to-sync-google-calendar-with-outlook",
      "/blog/how-to-sync-icloud-calendar-with-google",
    ]);
  });

  it("does not invent a Fastmail post when the library has none", () => {
    const latest = selectHomepageLatestArticles(
      [
        summary("/blog/how-to-sync-google-calendar-with-outlook", "2026-08-17"),
        summary("/blog/how-to-sync-icloud-calendar-with-google", "2026-08-16"),
        summary("/blog/how-to-give-claude-access-to-your-calendar-mcp", "2026-08-20", ["mcp"]),
      ],
      6,
    );

    expect(latest.map((article) => article.path)).toEqual([
      "/blog/how-to-sync-google-calendar-with-outlook",
      "/blog/how-to-sync-icloud-calendar-with-google",
    ]);
  });

  it("does not mutate the library", () => {
    const originalOrder = homepageLibrary.map((article) => article.path);
    selectHomepageLatestArticles(homepageLibrary, 6);
    expect(homepageLibrary.map((article) => article.path)).toEqual(originalOrder);
  });
});
