import { describe, expect, test } from "vitest";
import { normalizeCollectionKey } from "../../src/identity/collection-key";
import { normalizeResourcePath } from "../../src/identity/resource-path";
import { calendarPath, serverUrl } from "../support/fake-caldav";

describe("one collection has one key, however the server spelt it", () => {
  test("DAV-O18: a trailing slash, a percent-encoded segment and an absolute href all resolve to one calendar key", () => {
    const spellings = [
      calendarPath,
      calendarPath.slice(0, -1),
      `${serverUrl}${calendarPath}`,
      "/calendars/alice//personal/",
      "/calendars/alice/personal%2F",
    ];

    const keys = spellings.map((href) => normalizeCollectionKey(href, serverUrl).value);

    expect(new Set(keys).size).toBe(1);
  });

  test("DAV-O18: a percent-encoded resource href normalises to its decoded pathname", () => {
    const encoded = normalizeResourcePath(
      `${calendarPath}team%20offsite.ics`,
      serverUrl,
    );
    const decoded = normalizeResourcePath(`${calendarPath}team offsite.ics`, serverUrl);

    expect(encoded).toBe(decoded);
    expect(encoded).toBe(`${calendarPath}team offsite.ics`);
  });
});
