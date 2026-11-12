import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarEvent } from "../../../../src/hooks/use-events";
import { CalendarColorDot } from "../../../../src/features/dashboard/components/calendar-color-dot";
import { EventCard, EventPill } from "../../../../src/features/dashboard/components/event-card";
import {
  EVENT_BLUE,
  resolveEventColor,
  resolveEventTint,
} from "../../../../src/features/dashboard/components/event-card.styles";

const event = (colors: Pick<CalendarEvent, "color" | "calendarColor">): CalendarEvent => ({
  id: "event-1",
  eventStateId: null,
  title: "Standup",
  description: null,
  location: null,
  startTime: new Date(2026, 0, 5, 9),
  endTime: new Date(2026, 0, 5, 10),
  isAllDay: false,
  calendarId: "calendar-1",
  calendarName: "Work",
  calendarProvider: "google",
  calendarUrl: "",
  ...colors,
});

describe("resolveEventColor", () => {
  it("prefers the event's own colour", () => {
    expect(resolveEventColor({ color: "#d50000", calendarColor: "#039be5" })).toBe("#d50000");
  });

  it("inherits the calendar colour", () => {
    expect(resolveEventColor({ color: null, calendarColor: "#039be5" })).toBe("#039be5");
  });

  it("is null when neither is known", () => {
    expect(resolveEventColor({ color: null, calendarColor: null })).toBeNull();
  });
});

describe("resolveEventTint", () => {
  it("tints from the hex instead of the blue preset", () => {
    const tint = resolveEventTint("#33b679");
    expect(tint.className).toBe("event-tint");
    expect(tint.style).toEqual({ "--event-color": "#33b679" });
  });

  it("leaves a colourless event on the blue preset", () => {
    expect(resolveEventTint(null)).toEqual({ className: EVENT_BLUE, style: undefined });
  });

  it("keeps the blue preset for anything that is not a six-digit hex", () => {
    for (const color of ["preset7", "none", "#fff", "rebeccapurple", ""]) {
      expect(resolveEventTint(color)).toEqual({ className: EVENT_BLUE, style: undefined });
    }
  });
});

describe("event colour rendering", () => {
  it("carries the resolved colour and the grid geometry on a card", () => {
    const markup = renderToStaticMarkup(
      <EventCard
        event={event({ color: null, calendarColor: "#039be5" })}
        past={false}
        layout="grid"
        style={{ top: 48 }}
      />,
    );
    expect(markup).toContain("event-tint");
    expect(markup).toContain("--event-color:#039be5");
    expect(markup).toContain("top:48px");
  });

  it("keeps a colourless card untinted", () => {
    const markup = renderToStaticMarkup(
      <EventCard event={event({ color: null, calendarColor: null })} past={false} />,
    );
    expect(markup).not.toContain("event-tint");
    expect(markup).not.toContain("--event-color");
  });

  it("tints a pill from the event's own colour", () => {
    const markup = renderToStaticMarkup(
      <EventPill event={event({ color: "#d50000", calendarColor: "#039be5" })} past={false} />,
    );
    expect(markup).toContain("--event-color:#d50000");
  });

  it("tints the calendar dot, and falls back to the preset without a colour", () => {
    expect(renderToStaticMarkup(<CalendarColorDot color="#8e24aa" />)).toContain("--event-color:#8e24aa");
    expect(renderToStaticMarkup(<CalendarColorDot color={null} />)).not.toContain("event-tint");
  });
});
