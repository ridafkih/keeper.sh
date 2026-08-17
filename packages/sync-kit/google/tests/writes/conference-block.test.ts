import { describe, expect, test } from "vitest";
import { projectDescription } from "../../src/write/normalize";

const delimiter = "-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~::~:~::-";

const conferenceBlock = [
  "Join the meeting",
  delimiter,
  "Join with Google Meet: https://meet.google.com/abc-defg-hij",
  delimiter,
  "Bring the agenda",
].join("\n");

const escapedMarkup = "the config sets &lt;timeout&gt;30&lt;/timeout&gt; on purpose";

describe("a provider-owned region is projected exactly once", () => {
  test("GOOG-O20: projecting a description twice equals projecting it once and preserves escaped markup", () => {
    const once = projectDescription(conferenceBlock);
    const twice = projectDescription(once);

    expect(twice).toBe(once);
    expect(projectDescription(escapedMarkup)).toBe(escapedMarkup);
  });

  test("GOOG-O20: the delimiters go and the details they fenced are kept as ordinary prose", () => {
    const projected = projectDescription(conferenceBlock);

    expect(projected).not.toContain(delimiter);
    expect(projected).toContain("meet.google.com/abc-defg-hij");
    expect(projected).toContain("Join the meeting");
    expect(projected).toContain("Bring the agenda");
  });

  test("GOOG-O20: a marker wrapped in markup is still the anchor, not the line it sits on", () => {
    const wrapped = `Join the meeting\n<p>${delimiter}</p>\nJoin with Google Meet: https://meet.google.com/abc-defg-hij`;

    const projected = projectDescription(wrapped);

    expect(projected).not.toContain(delimiter);
    expect(projected).toContain("meet.google.com/abc-defg-hij");
  });

  test("GOOG-O20: a description that owns no provider region is untouched", () => {
    expect(projectDescription("just an ordinary description")).toBe("just an ordinary description");
    expect(projectDescription(null)).toBeNull();
  });
});
