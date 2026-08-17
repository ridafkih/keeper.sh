import { describe, expect, test } from "vitest";
import { expandKeeperProperties } from "../../src/decode/extended-property";
import {
  calendarViewSelect,
  instancesParameters,
  requestParameters,
} from "../../src/listing/request-shape";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { seedOf, seriesMasterItem } from "../support/items";

const fieldsTheDecoderReads: readonly string[] = [
  "id",
  "iCalUId",
  "subject",
  "body",
  "start",
  "end",
  "isAllDay",
  "isCancelled",
  "type",
  "seriesMasterId",
  "originalStartTimeZone",
  "originalEndTimeZone",
  "lastModifiedDateTime",
  "createdDateTime",
  "changeKey",
];

describe("every listing request retrieves what the decoder reads", () => {
  test("MS-H1: the delta request selects every field the decoder reads", () => {
    const selected: readonly string[] = calendarViewSelect;
    const missing = fieldsTheDecoderReads.filter((field) => !selected.includes(field));

    expect(missing).toEqual([]);
    expect(requestParameters(scopeOver(marchWindow), "delta")["$select"]).toBe(selected.join(","));
  });

  test("MS-H26: the window requests expand our extended properties instead of selecting fields", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([seriesMasterItem("master-select", "2026-03-16T09:00:00.0000000")]);
    harness.fake.putInstances("master-select", []);

    await harness.provider.listChanges(
      { scope: { ...scopeOver(marchWindow), expandRecurrences: true }, resume: null },
      operationContext(harness.environment, { deadlineMs: 5000 }),
    );

    const instanceRequest = harness.fake
      .requests()
      .find((request) => request.path.endsWith("/instances"));
    const windowRequest = harness.fake
      .requests()
      .find((request) => request.path.includes("/calendarView"));
    expect(instanceRequest?.search["$expand"]).toBe(expandKeeperProperties());
    expect(instanceRequest?.search["$select"]).toBeUndefined();
    expect(windowRequest?.search["$expand"]).toBe(expandKeeperProperties());
    expect(windowRequest?.search["$select"]).toBeUndefined();
    expect(instancesParameters(scopeOver(marchWindow))["$expand"]).toBe(expandKeeperProperties());
  }, 30_000);
});
