import { describe, expect, it } from "vitest";
import { resolveDestinationPrompt } from "../../../src/features/onboarding/destination-prompt";

const calendar = (id: string, calendarType: string, capabilities: string[]) => ({ calendarType, capabilities, id });

const work = calendar("work", "oauth", ["pull", "push"]);
const personal = calendar("personal", "oauth", ["pull", "push"]);
const family = calendar("family", "oauth", ["pull", "push"]);
const holidays = calendar("holidays", "oauth", ["pull"]);
const link = calendar("link", "ical", ["pull"]);
const secondLink = calendar("second-link", "ical", ["pull"]);
const readOnlyCaldav = calendar("shared", "caldav", ["pull"]);

describe("resolveDestinationPrompt", () => {
  it("offers the other writable calendars on the same account, in the order given", () => {
    expect(resolveDestinationPrompt([work, personal, family, holidays], [personal, family])).toEqual({
      destinations: [personal, family],
      kind: "same-account",
    });
  });

  it("asks for a second calendar when the first account has nothing else to write to", () => {
    expect(resolveDestinationPrompt([work, holidays], [])).toEqual({ kind: "connect" });
  });

  it("explains that links can't receive events when only links were added", () => {
    expect(resolveDestinationPrompt([link], [])).toEqual({ kind: "read-only-links" });
    expect(resolveDestinationPrompt([link, secondLink], [])).toEqual({ kind: "read-only-links" });
  });

  it("explains read-only calendars that are not links", () => {
    expect(resolveDestinationPrompt([link, readOnlyCaldav], [])).toEqual({ kind: "read-only" });
  });

  it("asks for a second calendar once a writable one is connected next to a link", () => {
    expect(resolveDestinationPrompt([link, work], [])).toEqual({ kind: "connect" });
  });
});
