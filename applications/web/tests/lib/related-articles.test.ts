import { describe, expect, it } from "vitest";
import {
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
