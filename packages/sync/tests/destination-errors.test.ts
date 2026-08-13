import { describe, expect, it } from "vitest";
import { RecurrenceMaterializationLimitError } from "@keeper.sh/calendar";
import {
  hasNoSuccessfulOperations,
  isBackoffEligibleError,
  resolveDestinationAttemptVerdict,
} from "../src/destination-errors";

const result = (overrides: Partial<Parameters<typeof hasNoSuccessfulOperations>[0]> = {}) => ({
  added: 0,
  addFailed: 0,
  conflictsResolved: 0,
  removed: 0,
  removeFailed: 0,
  ...overrides,
});

describe("isBackoffEligibleError", () => {
  it("matches invalid credentials", () => {
    expect(isBackoffEligibleError(new Error("Invalid credentials"))).toBe(true);
  });

  it("matches 404 not found from collection query", () => {
    const message = "Collection query failed: 404 Not Found. Raw response: The requested resource could not be found.";
    expect(isBackoffEligibleError(new Error(message))).toBe(true);
  });

  it("matches cannot find homeUrl", () => {
    expect(isBackoffEligibleError(new Error("cannot find homeUrl"))).toBe(true);
  });

  it("backs off only the destination poisoned by an over-budget recurrence", () => {
    const error = new RecurrenceMaterializationLimitError({
      calendarId: "source-calendar-id",
      eventId: "event-state-id",
      sourceEventUid: "pathological-series",
    }, 10_000);

    expect(isBackoffEligibleError(error)).toBe(true);
  });

  it("does not match transient 500 errors", () => {
    const message = "Collection query failed: 500 Internal Server Error. Raw response: <html>500</html>";
    expect(isBackoffEligibleError(new Error(message))).toBe(false);
  });

  it("does not match JSON parse errors", () => {
    expect(isBackoffEligibleError(new SyntaxError("Failed to parse JSON"))).toBe(false);
  });

  it("does not match unknown errors", () => {
    expect(isBackoffEligibleError(new Error("something unexpected"))).toBe(false);
  });

  it("handles non-Error values", () => {
    expect(isBackoffEligibleError("Invalid credentials")).toBe(true);
    expect(isBackoffEligibleError("random string")).toBe(false);
  });
});

describe("hasNoSuccessfulOperations", () => {
  it("reports a sync whose every delete failed", () => {
    expect(hasNoSuccessfulOperations(result({ removeFailed: 18 }))).toBe(true);
  });

  it("reports a sync whose every add failed", () => {
    expect(hasNoSuccessfulOperations(result({ addFailed: 4 }))).toBe(true);
  });

  it("does not report a sync that had nothing to do", () => {
    expect(hasNoSuccessfulOperations(result())).toBe(false);
  });

  it("does not report a sync that removed something alongside failures", () => {
    expect(hasNoSuccessfulOperations(result({ removeFailed: 17, removed: 1 }))).toBe(false);
  });

  it("does not report a sync that added something alongside failures", () => {
    expect(hasNoSuccessfulOperations(result({ addFailed: 3, added: 2 }))).toBe(false);
  });

  it("treats a resolved conflict as progress", () => {
    expect(hasNoSuccessfulOperations(result({ addFailed: 1, conflictsResolved: 1 }))).toBe(false);
  });
});

describe("resolveDestinationAttemptVerdict", () => {
  it("fails a run whose every operation failed", () => {
    expect(resolveDestinationAttemptVerdict(result({ addFailed: 3 }), false)).toBe("failed");
  });

  it("succeeds a run that made progress alongside failures", () => {
    expect(resolveDestinationAttemptVerdict(result({ added: 1, addFailed: 3 }), false))
      .toBe("succeeded");
  });

  it("succeeds a run that found the destination already in sync", () => {
    expect(resolveDestinationAttemptVerdict(result(), false)).toBe("succeeded");
  });

  it("is inconclusive when supersession stopped the run before any operation", () => {
    expect(resolveDestinationAttemptVerdict(result(), true)).toBe("inconclusive");
  });

  it("still fails a superseded run that attempted operations and failed all of them", () => {
    expect(resolveDestinationAttemptVerdict(result({ removeFailed: 2 }), true)).toBe("failed");
  });

  it("still succeeds a superseded run that pushed something before being cut short", () => {
    expect(resolveDestinationAttemptVerdict(result({ added: 2 }), true)).toBe("succeeded");
  });
});
