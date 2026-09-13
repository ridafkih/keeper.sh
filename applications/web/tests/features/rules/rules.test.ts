import { describe, expect, it } from "vitest";
import type { CalendarDetail } from "../../../src/types/api";
import { buildRuleGroups, countRules, resolveTitleMode, titleModeLabel } from "../../../src/features/rules/rules";
import { makeSource } from "../setup/fixtures";

const detail = (id: string, destinationIds: string[], overrides: Partial<CalendarDetail> = {}): CalendarDetail => ({
  calendarType: "oauth",
  calendarUrl: null,
  capabilities: ["pull", "push"],
  createdAt: "2026-01-01T00:00:00.000Z",
  customEventName: "{{calendar_name}}",
  destinationIds,
  disabled: false,
  excludeAllDayEvents: false,
  excludeEventDescription: true,
  excludeEventLocation: true,
  excludeEventName: true,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  id,
  ingestFailureCount: 0,
  ingestLastFailureAt: null,
  markEventsAsPrivate: false,
  name: id,
  originalName: null,
  provider: "google",
  providerIcon: null,
  providerMissingSince: null,
  providerName: "Google",
  sourceIds: [],
  syncFutureRange: "12_months",
  syncHistoricRange: "12_months",
  treatFullDayTimedEventsAsAllDay: false,
  unavailableSince: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  url: null,
  ...overrides,
});

describe("resolveTitleMode", () => {
  it("reads the stored title settings back into a choice", () => {
    expect(resolveTitleMode({ customEventName: "{{calendar_name}}", excludeEventName: true })).toBe("calendar_name");
    expect(resolveTitleMode({ customEventName: "", excludeEventName: true })).toBe("calendar_name");
    expect(resolveTitleMode({ customEventName: "Busy", excludeEventName: true })).toBe("busy");
    expect(resolveTitleMode({ customEventName: "{{calendar_name}}", excludeEventName: false })).toBe("titles");
    expect(resolveTitleMode({ customEventName: "Blocked", excludeEventName: true })).toBe("custom");
    expect(titleModeLabel("custom", "Blocked")).toBe("Blocked");
  });
});

describe("buildRuleGroups", () => {
  it("groups mappings under their source and skips sources without any", () => {
    const sources = [makeSource("work", "a"), makeSource("personal", "b"), makeSource("family", "b")];
    const groups = buildRuleGroups(sources, {
      family: detail("family", []),
      personal: detail("personal", ["work"], { customEventName: "Busy" }),
      work: detail("work", ["personal", "family", "gone"]),
    });
    expect(groups.map((group) => group.source.id)).toEqual(["work", "personal"]);
    expect(groups[0]?.rows.map((row) => row.destination.id)).toEqual(["personal", "family"]);
    expect(groups[1]?.rows[0]?.mode).toBe("busy");
    expect(countRules(groups)).toBe(3);
  });
});
