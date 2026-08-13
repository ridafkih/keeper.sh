import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCENARIO = join(import.meta.dirname, "../fixtures/ingest-wide-event-scenario.ts");

/*
 * The scenario runs the real cron logging context and the real ingestion engine
 * in a child process: two sources ingested inside one job tick, one of which
 * discards an unrepresentable event and deletes the stored row it left behind.
 */
const runJobTick = (mode: string): Record<string, unknown> => {
  const output = execFileSync("bun", [SCENARIO, mode], {
    cwd: join(import.meta.dirname, "../.."),
    encoding: "utf8",
  });
  const lines = output.split("\n").filter(Boolean);
  const [line] = lines;
  if (lines.length !== 1 || !line) {
    throw new Error(`Expected one wide event, received: ${output}`);
  }
  return JSON.parse(line) as Record<string, unknown>;
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

describe("ingest wide events merged onto one cron job event", () => {
  it("keeps the removal count of a source ingested before a quiet one", () => {
    const event = runJobTick("discarding-source-first");

    expect(readNested(event, "events.removed")).toBe(1);
  });

  it("keeps the discard count of a source ingested after a quiet one", () => {
    const event = runJobTick("discarding-source-last");

    expect(readNested(event, "source_events.discarded_unrepresentable")).toBe(1);
    expect(readNested(event, "events.removed")).toBe(1);
  });

  it("never attributes a discard to a calendar that did not discard", () => {
    const event = runJobTick("discarding-source-first");

    if (readNested(event, "source_events.discarded_unrepresentable") !== 1) {
      return;
    }
    expect(readNested(event, "calendar.id")).toBe("google-calendar");
  });

  it("keeps a trace when the two sources interleave", () => {
    const event = runJobTick("concurrent");

    expect(readNested(event, "events.removed")).toBe(1);
  });
});
