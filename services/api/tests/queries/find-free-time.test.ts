import { describe, expect, it } from "vitest";
import { isBlocking } from "../../src/queries/find-free-time";

const candidate = (overrides: {
  availability?: string | null;
  isAllDay?: boolean | null;
}) => ({
  endTime: new Date("2026-03-02T10:00:00Z"),
  startTime: new Date("2026-03-02T09:00:00Z"),
  ...overrides,
});

describe("isBlocking", () => {
  it("treats busy events as blocking", () => {
    expect(isBlocking(candidate({ availability: "busy" }), false)).toBe(true);
  });

  it("treats out-of-office events as blocking", () => {
    expect(isBlocking(candidate({ availability: "oof" }), false)).toBe(true);
  });

  it("treats free events as non-blocking", () => {
    expect(isBlocking(candidate({ availability: "free" }), false)).toBe(false);
  });

  it("treats working-elsewhere events as non-blocking", () => {
    expect(isBlocking(candidate({ availability: "workingElsewhere" }), false)).toBe(false);
  });

  it("treats an unknown availability as blocking", () => {
    expect(isBlocking(candidate({ availability: null }), false)).toBe(true);
    expect(isBlocking(candidate({}), false)).toBe(true);
  });

  it("blocks all-day busy events by default", () => {
    expect(isBlocking(candidate({ availability: "busy", isAllDay: true }), false)).toBe(true);
  });

  it("ignores all-day events when asked to", () => {
    expect(isBlocking(candidate({ availability: "busy", isAllDay: true }), true)).toBe(false);
  });

  it("still blocks timed events when all-day events are ignored", () => {
    expect(isBlocking(candidate({ availability: "busy", isAllDay: false }), true)).toBe(true);
  });

  it("keeps free all-day events non-blocking either way", () => {
    expect(isBlocking(candidate({ availability: "free", isAllDay: true }), false)).toBe(false);
  });
});
