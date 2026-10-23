import { describe, expect, it } from "vitest";
import { resolveWheelNotches } from "../../../../src/features/dashboard/components/wheel-notches";

const wheel = (deltaY: number, wheelDeltaY: number | undefined, extra = {}) => ({
  deltaY,
  wheelDeltaY,
  deltaMode: 0,
  ctrlKey: false,
  ...extra,
});

describe("resolveWheelNotches", () => {
  it("pages a row per notch for a Windows or Linux mouse wheel", () => {
    expect(resolveWheelNotches(wheel(100, -120), false)).toBe(1);
    expect(resolveWheelNotches(wheel(-300, 360), false)).toBe(-3);
  });

  it("pages for a mouse whose notch happens to be a third of its wheel delta", () => {
    expect(resolveWheelNotches(wheel(40, -120), false)).toBe(1);
  });

  it("pages for a macOS mouse wheel, whose pixel delta is small and accelerated", () => {
    expect(resolveWheelNotches(wheel(4.000244140625, -120), false)).toBe(1);
  });

  it("pages by direction for a line-mode wheel", () => {
    expect(resolveWheelNotches(wheel(3, undefined, { deltaMode: 1 }), false)).toBe(1);
    expect(resolveWheelNotches(wheel(-3, undefined, { deltaMode: 1 }), false)).toBe(-1);
  });

  it("leaves trackpad deltas to native scrolling on macOS and Windows", () => {
    expect(resolveWheelNotches(wheel(7, -21), false)).toBe(0);
    expect(resolveWheelNotches(wheel(25, -30), false)).toBe(0);
  });

  it("ignores a whole 120 that lands inside a trackpad gesture", () => {
    expect(resolveWheelNotches(wheel(100, -120), true)).toBe(0);
    expect(resolveWheelNotches(wheel(40, -120), true)).toBe(0);
  });

  it("leaves pinch-zoom and sideways wheels alone", () => {
    expect(resolveWheelNotches(wheel(100, -120, { ctrlKey: true }), false)).toBe(0);
    expect(resolveWheelNotches(wheel(0, 0), false)).toBe(0);
  });
});
