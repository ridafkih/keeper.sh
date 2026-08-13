import { describe, expect, it } from "vitest";
import {
  JOB_OWNED_WIDE_EVENT_KEYS,
  selectIngestWideEventFields,
} from "@keeper.sh/calendar";

const ENGINE_TELEMETRY_KEYS = [
  "events.added",
  "events.removed",
  "existing_events.count",
  "flushed",
  "recurrence.over_budget_count",
  "recurrence.over_budget_uids",
  "source_events.count",
  "source_events.discarded_outside_window",
  "source_events.discarded_unrepresentable",
  "source_events.skipped_resource_reasons",
  "source_events.skipped_resources",
  "source_events.skipped_self_authored",
  "source_events.unsupported_count",
  "source_events.unsupported_uids",
  "stored_events.invalid_count",
  "stored_events.invalid_ids",
  "stored_events.validation_errors",
];

describe("ingest telemetry survives the cron merge", () => {
  it("keeps every discard and diff counter the engine produces", () => {
    const engineEvent = Object.fromEntries(
      ENGINE_TELEMETRY_KEYS.map((key) => [key, 1]),
    );

    const merged = selectIngestWideEventFields(engineEvent);

    for (const key of ENGINE_TELEMETRY_KEYS) {
      expect(merged, `${key} was dropped by the cron merge`).toHaveProperty(key);
    }
  });

  it("never lets a discard counter fall into the job-owned set", () => {
    for (const key of ENGINE_TELEMETRY_KEYS) {
      expect(JOB_OWNED_WIDE_EVENT_KEYS.has(key), `${key} is job-owned`).toBe(false);
    }
  });

  it("strips only the fields the enclosing job owns and namespaces the rest", () => {
    const merged = selectIngestWideEventFields({
      "calendar.id": "cal-1",
      "duration_ms": 5,
      "error.message": "boom",
      "error.type": "Error",
      "operation.name": "ingest:source",
      "operation.type": "ingest",
      "outcome": "error",
      "source_events.discarded_unrepresentable": 4,
    });

    expect(merged).toEqual({
      "calendar.id": "cal-1",
      "ingest.duration_ms": 5,
      "ingest.outcome": "error",
      "source_events.discarded_unrepresentable": 4,
    });
  });

  it("preserves a zero discard count rather than dropping the field", () => {
    const merged = selectIngestWideEventFields({
      "source_events.discarded_outside_window": 0,
      "source_events.discarded_unrepresentable": 0,
    });

    expect(merged["source_events.discarded_outside_window"]).toBe(0);
    expect(merged["source_events.discarded_unrepresentable"]).toBe(0);
  });
});
