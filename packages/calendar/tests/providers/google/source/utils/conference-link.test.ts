import { describe, expect, it } from "vitest";
import { parseGoogleEvents } from "../../../../../src/providers/google/source/utils/fetch-events";
import type { GoogleCalendarEvent } from "../../../../../src/providers/google/source/types";
import { createSyncEventContentHash } from "../../../../../src/core/events/content-hash";

const missingDescription: Partial<GoogleCalendarEvent> = {};
const link = "https://meet.google.com/abc-defg-hij";
const parse = (overrides: Partial<GoogleCalendarEvent> = {}) => {
  const event: GoogleCalendarEvent = {
    id: "received-invitation",
    iCalUID: "external-invitation@google.com",
    summary: "Invited meeting",
    start: { dateTime: "2026-09-10T10:00:00Z" },
    end: { dateTime: "2026-09-10T11:00:00Z" },
    description: "Original invitation",
    ...overrides,
  };
  const before = structuredClone(event);
  const [parsed] = parseGoogleEvents([event]);
  expect(event).toEqual(before);
  if (!parsed) {
    throw new Error("Event was not parsed");
  }
  return parsed;
};

describe("Google conference links in copied descriptions", () => {
  it("preserves a received invitation's Meet link without mutating the source", () => {
    expect(parse({ hangoutLink: link }).description)
      .toBe(`Original invitation\n\nJoin Google Meet: ${link}`);
  });
  it("uses the video entry point and ignores dial-in entries", () => {
    expect(parse({ conferenceData: { entryPoints: [
      { entryPointType: "phone", uri: "tel:+123456" },
      { entryPointType: "video", uri: link },
    ] } }).description).toContain(link);
  });
  it("prefers hangoutLink when both representations exist", () => {
    const { description } = parse({ hangoutLink: link, conferenceData: {
      entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/other" }],
    } });
    expect(description).toContain(link);
    expect(description).not.toContain("/other");
  });
  it.each([missingDescription.description, ""])("handles an empty description: %s", (description) => {
    expect(parse({ description, hangoutLink: link }).description).toBe(`Join Google Meet: ${link}`);
  });
  it.each([`Join ${link}`, `<a href="${link}">Join</a>`])("avoids duplicates: %s", (description) => {
    expect(parse({ description, hangoutLink: link }).description).toBe(description);
  });
  it("preserves descriptions when no conference exists", () => {
    expect(parse().description).toBe("Original invitation");
    expect(parse({ description: missingDescription.description }).description).toBeUndefined();
  });
  it("falls back from invalid links to a valid video URL", () => {
    expect(parse({ hangoutLink: "ftp://example.com/meeting", conferenceData: {
      entryPoints: [{ entryPointType: "video", uri: link }],
    } }).description).toContain(link);
    expect(parse({ hangoutLink: "not a URL" }).description).toBe("Original invitation");
  });
  it("detects a changed or removed link through the existing content hash", () => {
    const first = parse({ hangoutLink: link });
    const changed = parse({ hangoutLink: "https://meet.google.com/new-link" });
    const removed = parse();
    expect(changed.description).not.toContain(link);
    expect(removed.description).toBe("Original invitation");
    const hashes = [first, changed, removed].map((event) => createSyncEventContentHash({
      ...event, summary: event.title ?? "",
    }));
    expect(new Set(hashes).size).toBe(3);
  });
});
