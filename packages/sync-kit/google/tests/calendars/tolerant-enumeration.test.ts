import { describe, expect, test } from "vitest";
import { createHarness, operationContext } from "../support/harness";

const account = { kind: "accountId", value: "google-account" } as const;

describe("enumeration tolerates the shapes Google actually returns", () => {
  test("GOOG-O23: a page with no items key and an unnamed calendar both enumerate", async () => {
    const empty = createHarness();
    empty.fake.answerCalendarListWith({ kind: "calendar#calendarList" });
    const unnamed = createHarness();
    unnamed.fake.answerCalendarListWith({
      kind: "calendar#calendarList",
      items: [{ id: "unnamed-calendar", accessRole: "owner" }],
    });

    const emptyAnswer = await empty.provider.listCalendars(
      account,
      operationContext(empty.environment),
    );
    const unnamedAnswer = await unnamed.provider.listCalendars(
      account,
      operationContext(unnamed.environment),
    );

    expect(emptyAnswer.ok).toBe(true);
    expect(unnamedAnswer.ok).toBe(true);
    if (!emptyAnswer.ok || !unnamedAnswer.ok) {
      throw new Error("a tolerable calendar list failed");
    }
    expect(emptyAnswer.value.calendars).toEqual([]);
    expect(unnamedAnswer.value.calendars.at(0)?.displayName).toBe("unnamed-calendar");
  });

  test("GOOG-O23: one unusable entry costs one entry, never the account", async () => {
    const harness = createHarness();
    harness.fake.answerCalendarListWith({
      kind: "calendar#calendarList",
      items: [{ accessRole: "owner" }, { id: "good-calendar", summary: "Good", accessRole: "owner" }],
    });

    const answer = await harness.provider.listCalendars(
      account,
      operationContext(harness.environment),
    );

    if (!answer.ok) {
      throw new Error("one unusable entry failed the whole enumeration");
    }
    expect(answer.value.calendars.map((calendar) => calendar.key.calendar.value)).toEqual([
      "good-calendar",
    ]);
  });

  test("GOOG-O23: a page that carries a next token is followed, never presented as a snapshot", async () => {
    const harness = createHarness();
    harness.fake.answerCalendarListWith({
      kind: "calendar#calendarList",
      nextPageToken: "there-is-more",
      items: [{ id: "first-page-calendar", accessRole: "owner" }],
    });

    const answer = await harness.provider.listCalendars(
      account,
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    expect(answer.ok).toBe(false);
    if (answer.ok) {
      throw new Error("a truncated enumeration was presented as a complete one");
    }
    expect(answer.failure).toEqual({ kind: "notAttempted", reason: "budgetExhausted" });
    expect(harness.fake.requests().length).toBeGreaterThan(1);
  }, 30_000);

  test("GOOG-O23: an empty enumeration is a snapshot, not proof everything was deleted", async () => {
    const harness = createHarness();
    harness.fake.answerCalendarListWith({ kind: "calendar#calendarList", items: [] });

    const answer = await harness.provider.listCalendars(
      account,
      operationContext(harness.environment),
    );

    if (!answer.ok) {
      throw new Error("an empty enumeration failed");
    }
    expect(answer.value.kind).toBe("snapshot");
  });
});
