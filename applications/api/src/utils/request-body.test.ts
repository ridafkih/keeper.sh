import { describe, expect, it } from "bun:test";
import { type } from "arktype";
import {
  calendarIdsBodySchema,
  sourcePatchBodySchema,
  icalSettingsPatchBodySchema,
  eventCreateBodySchema,
  eventPatchBodySchema,
  tokenCreateBodySchema,
} from "./request-body";

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
    });
    expect(result instanceof type.errors).toBe(false);
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

