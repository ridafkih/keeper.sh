import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCENARIO = join(import.meta.dirname, "../fixtures/ingest-wide-event-scenario.ts");

const runJobTick = (mode: string): Record<string, unknown>[] => {
  const output = execFileSync("bun", [SCENARIO, mode], {
    cwd: join(import.meta.dirname, "../.."),
    encoding: "utf8",
  });
  const events = output
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  if (events.length !== 3) {
    throw new Error(`Expected two source events and one job event, received: ${output}`);
  }
  return events;
};

const readNested = (event: Record<string, unknown>, path: string): unknown => {
  let value: unknown = event;
  for (const segment of path.split(".")) {
    if (typeof value !== "object" || value === null) {
      return null;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
};

const sourceEventFor = (
  events: Record<string, unknown>[],
  calendarId: string,
): Record<string, unknown> => {
  const event = events.find((candidate) => readNested(candidate, "calendar.id") === calendarId);
  if (!event) {
    throw new Error(`No wide event for ${calendarId} in ${JSON.stringify(events)}`);
  }
  return event;
};

describe("ingest wide events emitted inside one cron job tick", () => {
  it.each(["discarding-source-first", "discarding-source-last", "concurrent"])(
    "keeps the discard and removal counts of the discarding source (%s)",
    (mode) => {
      const events = runJobTick(mode);
      const google = sourceEventFor(events, "google-calendar");

      expect(readNested(google, "source_events.discarded_unrepresentable")).toBe(1);
      expect(readNested(google, "events.removed")).toBe(1);
    },
  );

  it.each(["discarding-source-first", "discarding-source-last", "concurrent"])(
    "never attributes a discard or removal to a calendar that had none (%s)",
    (mode) => {
      const events = runJobTick(mode);
      const ics = sourceEventFor(events, "ics-calendar");

      expect(readNested(ics, "source_events.discarded_unrepresentable")).toBeFalsy();
      expect(readNested(ics, "events.removed")).toBe(0);
    },
  );

  it("leaves the job-level tick event free of any single source's counts", () => {
    const events = runJobTick("discarding-source-first");
    const job = events.find((candidate) => readNested(candidate, "operation.name") === "ingest-sources");

    expect(job).toBeDefined();
    expect(readNested(job ?? {}, "calendar.id")).toBeNull();
    expect(readNested(job ?? {}, "source_events.discarded_unrepresentable")).toBeNull();
  });
});
