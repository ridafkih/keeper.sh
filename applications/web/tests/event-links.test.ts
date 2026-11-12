import { describe, expect, it } from "vitest";
import { findEventLinks, findPrimaryEventLink, trimUrl } from "../src/lib/event-links";

const event = (location: string | null, description: string | null) => ({ location, description });

describe("findPrimaryEventLink", () => {
  it("picks a Zoom link out of the location", () => {
    const link = findPrimaryEventLink(event("https://us02web.zoom.us/j/123456789?pwd=abc", null));
    expect(link).toEqual({ url: "https://us02web.zoom.us/j/123456789?pwd=abc", label: "Zoom", isMeeting: true });
  });

  it("finds a Google Meet link in a description", () => {
    const link = findPrimaryEventLink(
      event(null, "Join with Google Meet: https://meet.google.com/abc-defg-hij\nOr dial: +1 555 0100"),
    );
    expect(link?.label).toBe("Google Meet");
    expect(link?.url).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("finds a bracketed Teams link and prefers it over earlier plain links", () => {
    const link = findPrimaryEventLink(
      event(
        "Room 4",
        "Agenda: https://docs.example.com/agenda.\nJoin: <https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0?context=%7b%7d>",
      ),
    );
    expect(link?.label).toBe("Teams");
    expect(link?.url).toBe("https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0?context=%7b%7d");
  });

  it("decodes HTML-escaped ampersands", () => {
    const link = findPrimaryEventLink(event(null, '<a href="https://zoom.us/j/1?pwd=a&amp;from=addon">Join</a>'));
    expect(link?.url).toBe("https://zoom.us/j/1?pwd=a&from=addon");
  });

  it("uses a bare URL location as an open-link button", () => {
    const link = findPrimaryEventLink(event("https://www.example.com/event/42", null));
    expect(link).toEqual({ url: "https://www.example.com/event/42", label: "example.com", isMeeting: false });
  });

  it("returns nothing for a street address or a non-meeting link in the description", () => {
    expect(findPrimaryEventLink(event("1 Infinite Loop, Cupertino", "Notes https://example.com/notes"))).toBeNull();
    expect(findPrimaryEventLink(event(null, null))).toBeNull();
  });

  it("does not treat Zoom marketing pages as meetings", () => {
    expect(findPrimaryEventLink(event(null, "Get the app: https://zoom.us/download"))).toBeNull();
  });

  it("ignores lookalike hosts", () => {
    expect(findPrimaryEventLink(event(null, "https://zoom.us.evil.example/j/1"))).toBeNull();
  });
});

describe("findEventLinks", () => {
  it("deduplicates links shared by location and description", () => {
    const url = "https://meet.google.com/abc-defg-hij";
    expect(findEventLinks(event(url, `Join ${url}`))).toHaveLength(1);
  });
});

describe("trimUrl", () => {
  it("drops trailing punctuation and unbalanced brackets", () => {
    expect(trimUrl("https://example.com/a.")).toBe("https://example.com/a");
    expect(trimUrl("https://example.com/a),")).toBe("https://example.com/a");
    expect(trimUrl("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
  });
});
