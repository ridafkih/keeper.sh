import type { RemoteEvent } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { assembleSeries } from "../../src/listing/assemble-series";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { seriesMaster, timedItem } from "../support/items";

const master = seriesMaster("weekly", "RRULE:FREQ=WEEKLY;COUNT=4", "2026-03-02T09:00:00.000Z");

const override = {
  ...timedItem({
    id: "weekly_20260309T090000Z",
    uid: "weekly@google.com",
    start: "2026-03-09T14:00:00.000Z",
    end: "2026-03-09T15:00:00.000Z",
  }),
  recurringEventId: "weekly",
  originalStartTime: { dateTime: "2026-03-09T09:00:00.000Z", timeZone: "UTC" },
};

const listing = async (items: readonly (typeof master | typeof override)[], pageSize: number) => {
  const harness = createHarness();
  harness.fake.putItems(items);
  harness.fake.pageEvery(pageSize);

  return listingOf(
    await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment),
    ),
  );
};

const seriesIn = (events: readonly RemoteEvent[]): readonly RemoteEvent[] =>
  events.filter((event) => event.content.recurrence !== null);

const detachedIn = (events: readonly RemoteEvent[]): readonly RemoteEvent[] =>
  events.filter((event) => event.content.recurrence === null);

describe("a master and its overrides reassemble across pages", () => {
  test("GOOG-O19: an override arriving before its master on an earlier page assembles into one series", async () => {
    const listed = await listing([override, master], 1);
    const events = listed.events ?? [];

    expect(seriesIn(events)).toHaveLength(1);
    expect(seriesIn(events).at(0)?.content.recurrence?.value).toBe("RRULE:FREQ=WEEKLY;COUNT=4");
  });

  test("GOOG-O19: a moved occurrence vacates its original slot and is carried at its new time", async () => {
    const listed = await listing([override, master], 1);
    const events = listed.events ?? [];

    expect(seriesIn(events).at(0)?.content.recurrence?.exceptions).toEqual([
      "EXDATE:20260309T090000Z",
    ]);
    expect(detachedIn(events)).toHaveLength(1);
    expect(detachedIn(events).at(0)?.content.time).toEqual({
      kind: "timed",
      start: { kind: "instant", value: "2026-03-09T14:00:00.000Z" },
      end: { kind: "instant", value: "2026-03-09T15:00:00.000Z" },
      zone: { kind: "zoneId", value: "UTC" },
    });
  });

  test("GOOG-O19: the moved occurrence takes an identity of its own, never the master's", async () => {
    const listed = await listing([override, master], 1);
    const events = listed.events ?? [];
    const uids = events.map((event) => event.uid.value);

    expect(new Set(uids).size).toBe(uids.length);
    expect(detachedIn(events).at(0)?.uid.value).toBe("weekly@google.com#20260309T090000Z");
  });

  test("GOOG-O19: an override behaves the same whether or not its master shares the page set", async () => {
    const withMaster = await listing([override, master], 1);
    const alone = await listing([override], 1);

    const detached = detachedIn(withMaster.events ?? []).at(0);
    const orphaned = detachedIn(alone.events ?? []).at(0);
    expect(orphaned?.uid.value).toBe(detached?.uid.value);
    expect(orphaned?.content.time).toEqual(detached?.content.time);
  });

  test("GOOG-O19: assembly is order independent", () => {
    const overrideFirst = assembleSeries([override, master]);
    const masterFirst = assembleSeries([master, override]);

    expect(overrideFirst).toEqual(masterFirst);
    expect(overrideFirst.series).toHaveLength(1);
    expect(overrideFirst.series.at(0)?.overrides).toHaveLength(1);
  });

  test("GOOG-O19: an override whose master never arrived is reported, never invented", () => {
    const assembled = assembleSeries([override]);

    expect(assembled.series).toEqual([]);
    expect(assembled.orphanedOverrides).toEqual([
      { seriesId: "weekly", originalStart: "2026-03-09T09:00:00.000Z" },
    ]);
  });
});
