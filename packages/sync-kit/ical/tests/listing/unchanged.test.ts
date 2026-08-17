import { describe, expect, test } from "vitest";
import { feedContentHash, projectIcsFeed } from "../../src/index";
import { calendarWith, simpleEvent, testScope } from "../support/feed";
import { testOptions } from "../support/options";

const body = calendarWith([
  ...simpleEvent("evt-1", "20260310T090000Z", "20260310T100000Z"),
  ...simpleEvent("evt-2", "20260311T090000Z", "20260311T100000Z"),
]);

describe("a feed whose bytes have not changed since the last poll", () => {
  test("ICAL-O38: an unchanged body still yields the full projection", () => {
    const projection = projectIcsFeed({
      body,
      scope: testScope,
      previousContentHash: feedContentHash(body),
      options: testOptions(),
    });

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.freshness).toBe("unchanged");
    expect(projection.value.listing.events).toHaveLength(2);
    expect(projection.value.usable).toHaveLength(2);
  });

  test("ICAL-O38: freshness is a field beside a complete listing, never an early return", () => {
    const changed = projectIcsFeed({
      body,
      scope: testScope,
      previousContentHash: feedContentHash(`${body}\r\n`),
      options: testOptions(),
    });
    const unchanged = projectIcsFeed({
      body,
      scope: testScope,
      previousContentHash: feedContentHash(body),
      options: testOptions(),
    });

    expect(changed.ok && unchanged.ok).toBe(true);
    if (!changed.ok || !unchanged.ok) {
      return;
    }
    expect(changed.value.freshness).toBe("changed");
    expect(unchanged.value.listing).toEqual(changed.value.listing);
  });

  test("ICAL-I38: the feed content hash and the canonical event fingerprint are different jobs", () => {
    expect(feedContentHash(body).value).not.toBe(feedContentHash(`${body} `).value);
  });
});
