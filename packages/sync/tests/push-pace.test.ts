import { describe, expect, it } from "vitest";
import { GOOGLE_PUSH_REQUESTS_PER_MINUTE, OUTLOOK_REQUESTS_PER_MINUTE } from "@keeper.sh/constants";
import { resolvePushPace, withPushPace } from "../src/push-pace";

describe("resolvePushPace", () => {
  it("paces rate-limited destinations at the ceiling their push limiter enforces", () => {
    expect(resolvePushPace("google")).toEqual({ lane: "google", operationsPerMinute: GOOGLE_PUSH_REQUESTS_PER_MINUTE });
    expect(resolvePushPace("outlook")).toEqual({ lane: "outlook", operationsPerMinute: OUTLOOK_REQUESTS_PER_MINUTE });
  });

  it("knows no ceiling for destinations without a push limiter", () => {
    expect(resolvePushPace("caldav")).toBeNull();
  });
});

describe("withPushPace", () => {
  it("stamps every progress update with the destination's pace", () => {
    const received: unknown[] = [];
    const onProgress = withPushPace("outlook", (update) => received.push(update));

    onProgress?.({
      calendarId: "cal-1",
      inSync: false,
      localEventCount: 0,
      remoteEventCount: 0,
      stage: "processing",
      status: "syncing",
      userId: "user-1",
    });

    expect(received).toEqual([expect.objectContaining({
      pace: { lane: "outlook", operationsPerMinute: OUTLOOK_REQUESTS_PER_MINUTE },
    })]);
  });

  it("passes updates through untouched when the pace is unknown", () => {
    const received: unknown[] = [];
    const onProgress = withPushPace("caldav", (update) => received.push(update));

    onProgress?.({
      calendarId: "cal-1",
      inSync: false,
      localEventCount: 0,
      remoteEventCount: 0,
      stage: "processing",
      status: "syncing",
      userId: "user-1",
    });

    expect(received).toEqual([expect.not.objectContaining({ pace: expect.anything() })]);
  });
});
