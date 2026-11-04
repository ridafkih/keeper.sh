import { describe, expect, it } from "vitest";
import { type } from "arktype";
import {
  MAX_EXCLUDE_TITLE_KEYWORDS,
  MAX_EXCLUDE_TITLE_KEYWORD_LENGTH,
} from "@keeper.sh/data-schemas";
import {
  calendarIdsBodySchema,
  sourcePatchBodySchema,
  icalSettingsPatchBodySchema,
  eventCreateBodySchema,
  eventPatchBodySchema,
  tokenCreateBodySchema,
  icalFeedCreateBodySchema,
  icalFeedPatchBodySchema,
} from "../../src/utils/request-body";

describe("calendarIdsBodySchema", () => {
  it("accepts valid calendarIds array", () => {
    const result = calendarIdsBodySchema({ calendarIds: ["id-1", "id-2"] });
    expect(result instanceof type.errors).toBe(false);
  });

  it("rejects missing calendarIds", () => {
    const result = calendarIdsBodySchema({});
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects non-string array elements", () => {
    const result = calendarIdsBodySchema({ calendarIds: [123] });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects extra properties", () => {
    const result = calendarIdsBodySchema({ calendarIds: ["id-1"], extra: true });
    expect(result instanceof type.errors).toBe(true);
  });
});

describe("sourcePatchBodySchema", () => {
  it("accepts valid partial source update", () => {
    const result = sourcePatchBodySchema({ name: "New Name" });
    expect(result instanceof type.errors).toBe(false);
  });

  it("accepts empty object (all fields optional)", () => {
    const result = sourcePatchBodySchema({});
    expect(result instanceof type.errors).toBe(false);
  });

  it("accepts boolean exclude fields", () => {
    const result = sourcePatchBodySchema({
      excludeAllDayEvents: true,
      excludeEventDescription: false,
      treatFullDayTimedEventsAsAllDay: true,
    });
    expect(result instanceof type.errors).toBe(false);
  });

  it("accepts mapped historic and future sync ranges", () => {
    const result = sourcePatchBodySchema({
      syncFutureRange: "2_years",
      syncHistoricRange: "3_months",
    });
    expect(result instanceof type.errors).toBe(false);
  });

  it("rejects arbitrary sync ranges", () => {
    const result = sourcePatchBodySchema({ syncHistoricRange: "90_days" });
    expect(result instanceof type.errors).toBe(true);
  });

  it("accepts markEventsAsPrivate as boolean", () => {
    const result = sourcePatchBodySchema({ markEventsAsPrivate: true });
    expect(result instanceof type.errors).toBe(false);
  });

  it("accepts excluded statuses", () => {
    const result = sourcePatchBodySchema({ excludeAvailabilities: ["busy", "free", "tentative"] });
    expect(result instanceof type.errors).toBe(false);
  });

  it("accepts excludeFreeEvents from clients loaded before excluded statuses", () => {
    const result = sourcePatchBodySchema({ excludeFreeEvents: true });
    expect(result instanceof type.errors).toBe(false);
  });

  it("rejects statuses that cannot be excluded", () => {
    const result = sourcePatchBodySchema({ excludeAvailabilities: ["workingElsewhere"] });
    expect(result instanceof type.errors).toBe(true);
  });

  it("accepts title keywords at their limits", () => {
    const result = sourcePatchBodySchema({
      excludeTitleKeywords: Array.from(
        { length: MAX_EXCLUDE_TITLE_KEYWORDS },
        () => "x".repeat(MAX_EXCLUDE_TITLE_KEYWORD_LENGTH),
      ),
    });
    expect(result instanceof type.errors).toBe(false);
  });

  it("rejects an empty title keyword", () => {
    const result = sourcePatchBodySchema({ excludeTitleKeywords: [""] });
    expect(result instanceof type.errors).toBe(true);
  });

  it(`rejects more than ${MAX_EXCLUDE_TITLE_KEYWORDS} title keywords`, () => {
    const result = sourcePatchBodySchema({
      excludeTitleKeywords: Array.from({ length: MAX_EXCLUDE_TITLE_KEYWORDS + 1 }, () => "x"),
    });
    expect(result instanceof type.errors).toBe(true);
  });

  it(`rejects title keywords longer than ${MAX_EXCLUDE_TITLE_KEYWORD_LENGTH} characters`, () => {
    const result = sourcePatchBodySchema({
      excludeTitleKeywords: ["x".repeat(MAX_EXCLUDE_TITLE_KEYWORD_LENGTH + 1)],
    });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects extra properties", () => {
    const result = sourcePatchBodySchema({ name: "ok", hacker: true });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects wrong types", () => {
    const result = sourcePatchBodySchema({ name: 123 });
    expect(result instanceof type.errors).toBe(true);
  });
});

describe("icalSettingsPatchBodySchema", () => {
  it("accepts valid ical settings", () => {
    const result = icalSettingsPatchBodySchema({
      includeEventName: true,
      customEventName: "Busy",
    });
    expect(result instanceof type.errors).toBe(false);
  });

  it("rejects extra properties", () => {
    const result = icalSettingsPatchBodySchema({ foo: "bar" });
    expect(result instanceof type.errors).toBe(true);
  });
});

describe("eventCreateBodySchema", () => {
  it("passes a wall time and its timezone through to the event time parser", () => {
    const result = eventCreateBodySchema({
      calendarId: "abc-123",
      title: "Team Meeting",
      startTime: "2026-11-05T09:00:00",
      endTime: "2026-11-05T10:00:00",
      timezone: "America/Edmonton",
    });
    expect(result).toEqual({
      calendarId: "abc-123",
      title: "Team Meeting",
      startTime: "2026-11-05T09:00:00",
      endTime: "2026-11-05T10:00:00",
      timezone: "America/Edmonton",
    });
  });

  it("accepts valid event creation body", () => {
    const result = eventCreateBodySchema({
      calendarId: "abc-123",
      title: "Team Meeting",
      startTime: "2026-03-15T14:00:00Z",
      endTime: "2026-03-15T15:00:00Z",
    });
    expect(result instanceof type.errors).toBe(false);
  });

  it("accepts optional fields", () => {
    const result = eventCreateBodySchema({
      calendarId: "abc-123",
      title: "Lunch",
      startTime: "2026-03-15T12:00:00Z",
      endTime: "2026-03-15T13:00:00Z",
      description: "Team lunch",
      location: "Cafe",
      isAllDay: false,
      availability: "busy",
    });
    expect(result instanceof type.errors).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = eventCreateBodySchema({ title: "Missing fields" });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects invalid availability value", () => {
    const result = eventCreateBodySchema({
      calendarId: "abc-123",
      title: "Test",
      startTime: "2026-03-15T14:00:00Z",
      endTime: "2026-03-15T15:00:00Z",
      availability: "maybe",
    });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects extra properties", () => {
    const result = eventCreateBodySchema({
      calendarId: "abc-123",
      title: "Test",
      startTime: "2026-03-15T14:00:00Z",
      endTime: "2026-03-15T15:00:00Z",
      hacker: true,
    });
    expect(result instanceof type.errors).toBe(true);
  });
});

describe("eventPatchBodySchema", () => {
  it("accepts an update that only changes the timezone", () => {
    const result = eventPatchBodySchema({ timezone: "America/Edmonton" });
    expect(result).toEqual({ timezone: "America/Edmonton" });
  });

  it("accepts partial event update", () => {
    const result = eventPatchBodySchema({ title: "Updated Title" });
    expect(result instanceof type.errors).toBe(false);
  });

  it("accepts empty object (all fields optional)", () => {
    const result = eventPatchBodySchema({});
    expect(result instanceof type.errors).toBe(false);
  });

  it("accepts rsvpStatus field", () => {
    const result = eventPatchBodySchema({ rsvpStatus: "accepted" });
    expect(result instanceof type.errors).toBe(false);
  });

  it("rejects invalid rsvpStatus", () => {
    const result = eventPatchBodySchema({ rsvpStatus: "maybe" });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects extra properties", () => {
    const result = eventPatchBodySchema({ title: "ok", inject: true });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects wrong types", () => {
    const result = eventPatchBodySchema({ title: 123 });
    expect(result instanceof type.errors).toBe(true);
  });
});

describe("tokenCreateBodySchema", () => {
  it("accepts valid token name", () => {
    const result = tokenCreateBodySchema({ name: "My API Token" });
    expect(result instanceof type.errors).toBe(false);
  });

  it("rejects missing name", () => {
    const result = tokenCreateBodySchema({});
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects non-string name", () => {
    const result = tokenCreateBodySchema({ name: 123 });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects extra properties", () => {
    const result = tokenCreateBodySchema({ name: "ok", extra: true });
    expect(result instanceof type.errors).toBe(true);
  });
});

describe("icalFeedCreateBodySchema", () => {
  it("accepts a feed name", () => {
    const result = icalFeedCreateBodySchema({ name: "Work only" });
    expect(result instanceof type.errors).toBe(false);
  });

  it("rejects a missing name", () => {
    const result = icalFeedCreateBodySchema({});
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects a client-supplied token", () => {
    const result = icalFeedCreateBodySchema({ name: "Work only", token: "feed_chosen" });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects extra properties", () => {
    const result = icalFeedCreateBodySchema({ name: "ok", isDefault: true });
    expect(result instanceof type.errors).toBe(true);
  });
});

describe("icalFeedPatchBodySchema", () => {
  const patchableFields: Record<string, string | boolean>[] = [
    { name: "Work only" },
    { includeEventName: true },
    { includeEventDescription: true },
    { includeEventLocation: true },
    { excludeAllDayEvents: true },
    { excludeFocusTime: true },
    { excludeOutOfOffice: true },
    { customEventName: "Away" },
  ];

  it.each(patchableFields)("accepts %o", (field) => {
    const result = icalFeedPatchBodySchema(field);
    expect(result instanceof type.errors).toBe(false);
  });

  it("rejects extra properties", () => {
    const result = icalFeedPatchBodySchema({ name: "ok", legacyAlias: false });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects a client-supplied token", () => {
    const result = icalFeedPatchBodySchema({ token: "feed_chosen" });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects wrong types", () => {
    const result = icalFeedPatchBodySchema({ excludeFocusTime: "yes" });
    expect(result instanceof type.errors).toBe(true);
  });
});
