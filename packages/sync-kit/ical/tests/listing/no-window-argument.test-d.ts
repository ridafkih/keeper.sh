import type { TimeWindow } from "@keeper.sh/sync-protocol";
import { describe, expectTypeOf, test } from "vitest";
import { coverageForWholeFeed, projectIcsFeed } from "../../src/index";
import type { IcsFeedRequest } from "../../src/index";

describe("windowing is the caller's concern", () => {
  test("ICAL-O39: projectIcsFeed takes one request and nothing that could narrow the feed", () => {
    expectTypeOf(projectIcsFeed).parameters.toEqualTypeOf<[IcsFeedRequest]>();
  });

  test("ICAL-I39: coverageForWholeFeed is not parameterised by a window", () => {
    expectTypeOf(coverageForWholeFeed).parameters.not.toMatchTypeOf<[TimeWindow]>();
  });
});
