import { describe, expect, it } from "vitest";
import { loggedErrorFor, loggedFieldFor, loggedTextFor } from "../src/tracing/logged-text";

const PROMPT_MS = 1000;
const LONG = 100_000;

const elapsed = (run: () => unknown): number => {
  const startedAt = performance.now();
  run();
  return performance.now() - startedAt;
};

describe("the text recorded for a provider's words", () => {
  it.each([
    ["Calendar ada.lovelace@example.com not found", "Calendar [email] not found"],
    ['{"error":"notFound","calendar":"ada+work@mail.example.co.uk"}', '{"error":"notFound","calendar":"[email]"}'],
    ["The user ada@example.com.", "The user [email]."],
    ["mailto:ada@example.com, grace@example.org", "mailto:[email], [email]"],
    ["uid ada@example.com-2024 skipped", "uid [email]-2024 skipped"],
    ["uid ada@example.com.2024 skipped", "uid [email].2024 skipped"],
    ["Series 20231101T1200-ada@example.com exceeds the limit", "Series [email] exceeds the limit"],
  ])("replaces an address in %s", (text, expected) => {
    expect(loggedTextFor(text)).toBe(expected);
  });

  it.each([
    [
      "CalDAV multiget returned 1 of 2 requested objects for https://caldav.example.com/dav/calendars/user/ada@example.com/work/",
      "CalDAV multiget returned 1 of 2 requested objects for https://caldav.example.com/[path]",
    ],
    [
      "Redirect to https://login.example.com/authorize?token=abc123&user=ada crosses a boundary",
      "Redirect to https://login.example.com/[path] crosses a boundary",
    ],
    ["connect to https://ada:hunter2@feeds.example.com:8443/private.ics failed", "connect to https://feeds.example.com:8443/[path] failed"],
    ["redis://default:hunter2@cache.internal:6379", "redis://cache.internal:6379"],
    ['see "webcal://example.com/feed?key=abc"', 'see "webcal://example.com/[path]"'],
    ["https://example.com#section", "https://example.com/[path]"],
  ])("keeps the origin of a URL in %s", (text, expected) => {
    expect(loggedTextFor(text)).toBe(expected);
  });

  it.each([
    "https://www.google.com",
    "https://www.google.com/",
    "Failed to fetch events: 403: rateLimitExceeded",
    'Failed query: select "id" from "calendars" where "tags" @> $1 and "email" = $2',
    "at run (/app/node_modules/@keeper.sh/calendar/src/index.ts:10:3)",
    "/app/node_modules/.bun/drizzle-orm@0.45.2/node_modules/drizzle-orm/pg-core/session.js",
    "ratelimit:user-1:google",
    "Token refresh failed (400): invalid_grant AADSTS700082",
    "left @ right",
    "a ://b",
    "",
  ])("leaves %s as written", (text) => {
    expect(loggedTextFor(text)).toBe(text);
  });

  it("cuts text past the logged length and says so", () => {
    const logged = loggedTextFor("x".repeat(70_000));

    expect(logged).toHaveLength(65_536 + "... (truncated)".length);
    expect(logged.endsWith("... (truncated)")).toBe(true);
  });

  it.each([
    ["spaces", " ".repeat(LONG)],
    ["address separators", "@".repeat(LONG)],
    ["local part characters", "a".repeat(LONG)],
    ["local parts and separators", "a@".repeat(LONG / 2)],
    ["unfinished domains", "a@b.".repeat(LONG / 4)],
    ["dots after a separator", `a@${".".repeat(LONG)}`],
    ["numeric labels after a separator", `a@${"1.".repeat(LONG / 2)}`],
    ["scheme separators", "://".repeat(LONG / 3)],
    ["scheme characters", `${"a".repeat(LONG)}://`],
    ["schemes without hosts", "a://".repeat(LONG / 4)],
    ["one URL of path separators", `https://example.com${"/".repeat(LONG)}`],
    ["one authority of separators", `https://${"@".repeat(LONG)}`],
  ])("reads a long run of %s promptly", (_shape, text) => {
    expect(elapsed(() => loggedTextFor(text))).toBeLessThan(PROMPT_MS);
  });
});

describe("the fields recorded for an event", () => {
  it("applies the text rule to strings at any depth and leaves other values alone", () => {
    expect(loggedFieldFor({
      attempts: 3,
      nested: { reasons: ["ada@example.com: unreadable", "ok"], retriable: false },
      note: "from https://example.com/feed?key=abc",
      nothing: null,
    })).toEqual({
      attempts: 3,
      nested: { reasons: ["[email]: unreadable", "ok"], retriable: false },
      note: "from https://example.com/[path]",
      nothing: null,
    });
  });
});

describe("the error recorded for a failure", () => {
  it("is the error itself when its message needs no change", () => {
    const error = new RangeError("limit exceeded");

    expect(loggedErrorFor(error)).toBe(error);
  });

  it("keeps the name and frames of an error whose message is rewritten", () => {
    const error = new TypeError("Calendar ada@example.com not found");
    const logged = loggedErrorFor(error) as Error;

    expect(logged).not.toBe(error);
    expect(logged.name).toBe("TypeError");
    expect(logged.message).toBe("Calendar [email] not found");
    expect(logged.stack).toContain("Calendar [email] not found");
    expect(logged.stack).not.toContain("ada@example.com");
    expect(logged.stack).toContain("logged-text.test.ts");
    expect(error.message).toBe("Calendar ada@example.com not found");
  });

  it("applies the text rule to a thrown string", () => {
    expect(loggedErrorFor("ada@example.com refused")).toBe("[email] refused");
  });

  it("passes any other thrown value through", () => {
    const thrown = { status: 503 };

    expect(loggedErrorFor(thrown)).toBe(thrown);
  });
});
