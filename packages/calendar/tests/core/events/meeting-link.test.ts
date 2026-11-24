import { describe, expect, it } from "vitest";
import { appendMeetingLink, formatMeetingLinkLine } from "../../../src/core/events/meeting-link";
import { MEETING_LINK_LABELS } from "../../../src/core/events/meeting-link-labels";

const MEET_LINK = "https://meet.google.com/abc-defg-hij";
const ZOOM_LINK = "https://example.zoom.us/j/123456789";

describe("formatMeetingLinkLine", () => {
  it("labels a link by its host from the configured labels", () => {
    expect(formatMeetingLinkLine(MEET_LINK))
      .toBe(`${MEETING_LINK_LABELS.byHost["meet.google.com"]}: ${MEET_LINK}`);
  });

  it("labels a link on an unlisted host with the configured unknown host label", () => {
    expect(formatMeetingLinkLine(ZOOM_LINK))
      .toBe(`${MEETING_LINK_LABELS.unknownHost}: ${ZOOM_LINK}`);
  });

  it("fails loudly on a stored link that is not a URL", () => {
    expect(() => formatMeetingLinkLine("not a url")).toThrow();
  });
});

describe("appendMeetingLink", () => {
  it("appends the link line after the description", () => {
    expect(appendMeetingLink("Agenda", MEET_LINK))
      .toBe(`Agenda\n\n${formatMeetingLinkLine(MEET_LINK)}`);
  });

  it.each([globalThis.undefined, ""])("is only the link line when there is no description (%s)", (description) => {
    expect(appendMeetingLink(description, MEET_LINK)).toBe(formatMeetingLinkLine(MEET_LINK));
  });

  it.each([`Join ${MEET_LINK}`, `<a href="${MEET_LINK}">Join</a>`])(
    "leaves a description that already carries the link alone: %s",
    (description) => {
      expect(appendMeetingLink(description, MEET_LINK)).toBe(description);
    },
  );
});
