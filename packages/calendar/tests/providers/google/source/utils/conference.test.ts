import { describe, expect, it } from "vitest";
import { parseGoogleEvents } from "../../../../../src/providers/google/source/utils/fetch-events";
import type { GoogleCalendarEvent } from "../../../../../src/providers/google/source/types";

const MEET_URI = "https://meet.google.com/abc-defg-hij";

const parse = (overrides: Partial<GoogleCalendarEvent> = {}) => {
  const event: GoogleCalendarEvent = {
    id: "provider-event-id",
    iCalUID: "source-event@google.com",
    summary: "Weekly sync",
    start: { dateTime: "2026-09-10T10:00:00Z" },
    end: { dateTime: "2026-09-10T11:00:00Z" },
    ...overrides,
  };
  const before = structuredClone(event);
  const [parsed] = parseGoogleEvents([event]);
  /* The source invitation is read, never rewritten. */
  expect(event).toEqual(before);
  return parsed;
};

describe("reading a Google event's conference", () => {
  it("leaves an event with no meeting without a conference", () => {
    expect(parse()?.conference).toBeUndefined();
  });

  it("reads a meeting carried only by hangoutLink", () => {
    expect(parse({ hangoutLink: MEET_URI })?.conference).toEqual({
      solution: "hangoutsMeet",
      entryPoints: [{ type: "video", uri: MEET_URI }],
    });
  });

  it("reads a meeting carried by conferenceData entry points", () => {
    expect(parse({
      conferenceData: {
        conferenceId: "abc-defg-hij",
        conferenceSolution: { key: { type: "hangoutsMeet" } },
        entryPoints: [{ entryPointType: "video", label: "meet.google.com/abc-defg-hij", uri: MEET_URI }],
      },
    })?.conference).toEqual({
      solution: "hangoutsMeet",
      conferenceId: "abc-defg-hij",
      entryPoints: [{ type: "video", uri: MEET_URI, label: "meet.google.com/abc-defg-hij" }],
    });
  });

  it("keeps the phone entry point alongside the video one", () => {
    const conference = parse({
      hangoutLink: MEET_URI,
      conferenceData: {
        conferenceId: "abc-defg-hij",
        conferenceSolution: { key: { type: "hangoutsMeet" } },
        entryPoints: [
          { entryPointType: "video", uri: MEET_URI },
          { entryPointType: "phone", label: "+1 555-0100", pin: "123456", uri: "tel:+15550100" },
          { entryPointType: "more", uri: "https://tel.meet/abc-defg-hij?pin=123456" },
        ],
      },
    })?.conference;

    expect(conference?.entryPoints).toEqual([
      { type: "video", uri: MEET_URI },
      { type: "phone", uri: "tel:+15550100", label: "+1 555-0100", pin: "123456" },
      { type: "more", uri: "https://tel.meet/abc-defg-hij?pin=123456" },
    ]);
  });

  it("prefers the structured entry point over a stale hangoutLink", () => {
    const conference = parse({
      hangoutLink: "https://meet.google.com/old-stale-uri",
      conferenceData: {
        conferenceSolution: { key: { type: "hangoutsMeet" } },
        entryPoints: [{ entryPointType: "video", uri: MEET_URI }],
      },
    })?.conference;

    expect(conference?.entryPoints).toEqual([{ type: "video", uri: MEET_URI }]);
  });

  it("ignores a conference from another solution", () => {
    expect(parse({
      conferenceData: {
        conferenceSolution: { key: { type: "addOn" }, name: "Zoom" },
        entryPoints: [{ entryPointType: "video", uri: "https://example.zoom.us/j/123" }],
      },
    })?.conference).toBeUndefined();
  });

  it.each([
    "http://meet.google.com/abc-defg-hij",
    "https://meet.google.com.evil.example/abc-defg-hij",
    "https://meet.google.com",
    "not a url",
  ])("rejects %s as a Meet video link", (uri) => {
    expect(parse({ hangoutLink: uri })?.conference).toBeUndefined();
  });

  it("drops a dial-in that arrives without a usable video link", () => {
    expect(parse({
      conferenceData: {
        conferenceSolution: { key: { type: "hangoutsMeet" } },
        entryPoints: [{ entryPointType: "phone", uri: "tel:+15550100" }],
      },
    })?.conference).toBeUndefined();
  });

  it("keeps the conference on each occurrence of an expanded series", () => {
    const occurrences = parseGoogleEvents([
      {
        id: "series_20260910T100000Z",
        iCalUID: "series@google.com",
        summary: "Weekly sync",
        hangoutLink: MEET_URI,
        start: { dateTime: "2026-09-10T10:00:00Z" },
        end: { dateTime: "2026-09-10T11:00:00Z" },
      },
      {
        id: "series_20260917T100000Z",
        iCalUID: "series@google.com",
        summary: "Weekly sync",
        hangoutLink: MEET_URI,
        start: { dateTime: "2026-09-17T10:00:00Z" },
        end: { dateTime: "2026-09-17T11:00:00Z" },
      },
    ]);

    expect(occurrences).toHaveLength(2);
    for (const occurrence of occurrences) {
      expect(occurrence.conference?.entryPoints[0]?.uri).toBe(MEET_URI);
    }
  });

  it("lets a single occurrence carry a conference the rest of the series does not", () => {
    const [series, occurrence] = parseGoogleEvents([
      {
        id: "series_20260910T100000Z",
        iCalUID: "series@google.com",
        summary: "Weekly sync",
        start: { dateTime: "2026-09-10T10:00:00Z" },
        end: { dateTime: "2026-09-10T11:00:00Z" },
      },
      {
        id: "series_20260917T100000Z",
        iCalUID: "series@google.com",
        summary: "Weekly sync",
        hangoutLink: MEET_URI,
        start: { dateTime: "2026-09-17T10:00:00Z" },
        end: { dateTime: "2026-09-17T11:00:00Z" },
      },
    ]);

    expect(series?.conference).toBeUndefined();
    expect(occurrence?.conference?.entryPoints[0]?.uri).toBe(MEET_URI);
  });

  it("does not report a cancelled occurrence as a conference to mirror", () => {
    expect(parseGoogleEvents([
      {
        id: "series_20260917T100000Z",
        iCalUID: "series@google.com",
        status: "cancelled",
        hangoutLink: MEET_URI,
      },
    ])).toEqual([]);
  });
});
