import { describe, expect, it } from "vitest";
import { parseGoogleEvents } from "../../../../../src/providers/google/source/utils/fetch-events";
import type { GoogleCalendarEvent } from "../../../../../src/providers/google/source/types";

const MEET_LINK = "https://meet.google.com/abc-defg-hij";

const parse = (overrides: Partial<GoogleCalendarEvent> = {}) => {
  const event: GoogleCalendarEvent = {
    description: "Original invitation",
    end: { dateTime: "2026-09-10T11:00:00Z" },
    iCalUID: "external-invitation@google.com",
    id: "received-invitation",
    start: { dateTime: "2026-09-10T10:00:00Z" },
    summary: "Invited meeting",
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

describe("Google meeting links", () => {
  it("reads the video entry point and ignores dial-in entries", () => {
    const parsed = parse({ conferenceData: { entryPoints: [
      { entryPointType: "phone", uri: "tel:+1-555-0100" },
      { entryPointType: "video", uri: MEET_LINK },
    ] } });

    expect(parsed.meetingLink).toBe(MEET_LINK);
  });

  it("keeps the meeting link out of the description", () => {
    const parsed = parse({ conferenceData: { entryPoints: [
      { entryPointType: "video", uri: MEET_LINK },
    ] } });

    expect(parsed.description).toBe("Original invitation");
  });

  it("has no meeting link when the event has no video conference", () => {
    expect(parse().meetingLink).toBeUndefined();
    expect(parse({ conferenceData: { entryPoints: [
      { entryPointType: "phone", uri: "tel:+1-555-0100" },
    ] } }).meetingLink).toBeUndefined();
  });

  it.each(["not a url", "ftp://example.com/meeting"])(
    "fails loudly on a video entry point that is not a web link: %s",
    (uri) => {
      expect(() => parse({ conferenceData: { entryPoints: [
        { entryPointType: "video", uri },
      ] } })).toThrow();
    },
  );
});
