import { describe, expect, it } from "vitest";
import { comparePushEchoObservations } from "../../../src/core/events/push-echo";
import type { PushEchoObservation } from "../../../src/core/events/push-echo";

const makeObservation = (
  overrides: Partial<PushEchoObservation["content"]> = {},
  times: { endTime?: Date; startTime?: Date } = {},
): PushEchoObservation => ({
  content: {
    description: "",
    isAllDay: false,
    location: "",
    summary: "",
    ...overrides,
  },
  endTime: times.endTime ?? new Date("2026-03-15T10:00:00.000Z"),
  startTime: times.startTime ?? new Date("2026-03-15T09:00:00.000Z"),
});

describe("push echo divergence lengths", () => {
  it("reports sent and echoed lengths for a diverged description", () => {
    const divergence = comparePushEchoObservations(
      makeObservation({ description: "agenda for the sync" }),
      makeObservation({ description: "agenda" }),
    );

    expect(divergence.description).toBe(true);
    expect(divergence.lengths.description).toEqual({ echo: 6, sent: 19 });
  });

  it("distinguishes an appended echo from a truncated one by length alone", () => {
    const appended = comparePushEchoObservations(
      makeObservation({ description: "notes" }),
      makeObservation({ description: "notes\n\nJoin: https://example.test/x" }),
    );

    expect(appended.lengths.description).toEqual({ echo: 35, sent: 5 });
  });

  it("reports lengths for summary and location independently", () => {
    const divergence = comparePushEchoObservations(
      makeObservation({ location: "Room 101", summary: "Weekly" }),
      makeObservation({ location: "Room 1", summary: "Weekly sync" }),
    );

    expect(divergence.lengths.summary).toEqual({ echo: 11, sent: 6 });
    expect(divergence.lengths.location).toEqual({ echo: 6, sent: 8 });
  });

  it("reports a zero echo length when the echo emptied a non-empty field", () => {
    const divergence = comparePushEchoObservations(
      makeObservation({ description: "agenda" }),
      makeObservation({ description: "" }),
    );

    expect(divergence.lengths.description).toEqual({ echo: 0, sent: 6 });
  });

  it("omits lengths for fields that did not diverge", () => {
    const divergence = comparePushEchoObservations(
      makeObservation({ description: "agenda", location: "Room 1", summary: "Sync" }),
      makeObservation({ description: "agenda!", location: "Room 1", summary: "Sync" }),
    );

    expect(divergence.lengths).toEqual({ description: { echo: 7, sent: 6 } });
  });

  it("carries no lengths at all when nothing diverged", () => {
    const divergence = comparePushEchoObservations(
      makeObservation({ description: "agenda" }),
      makeObservation({ description: "agenda" }),
    );

    expect(divergence.lengths).toEqual({});
  });

  it("measures length in UTF-16 code units, matching the compared string", () => {
    const sent = "\u{1F600}\u{1F600}";
    const divergence = comparePushEchoObservations(
      makeObservation({ description: sent }),
      makeObservation({ description: "x" }),
    );

    expect(divergence.lengths.description).toEqual({ echo: 1, sent: sent.length });
    expect(sent.length).toBe(4);
  });
});
