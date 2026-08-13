import { describe, expect, it } from "vitest";
import { selectIngestWideEventFields } from "../../src/utils/ingest-wide-event";

describe("selectIngestWideEventFields", () => {
  it("keeps the ingestion diff counts the job otherwise discards", () => {
    expect(selectIngestWideEventFields({
      "events.added": 3,
      "events.removed": 1,
      "existing_events.count": 42,
      "source_events.count": 44,
      "source_events.discarded_outside_window": 2,
      "source_events.discarded_unrepresentable": 1,
    })).toEqual({
      "events.added": 3,
      "events.removed": 1,
      "existing_events.count": 42,
      "source_events.count": 44,
      "source_events.discarded_outside_window": 2,
      "source_events.discarded_unrepresentable": 1,
    });
  });

  it("drops the fields the surrounding job wide event already owns", () => {
    expect(selectIngestWideEventFields({
      "duration_ms": 12,
      "error.message": "boom",
      "error.type": "Error",
      "events.added": 0,
      "operation.name": "ingest:source",
      "operation.type": "ingest",
      "outcome": "error",
    })).toEqual({
      "events.added": 0,
      "ingest.duration_ms": 12,
      "ingest.outcome": "error",
    });
  });

  it("keeps the ingest-specific outcomes distinguishable under their own key", () => {
    for (const outcome of ["superseded", "unchanged", "in-sync", "full-sync-required"]) {
      expect(selectIngestWideEventFields({ flushed: false, outcome })).toEqual({
        "flushed": false,
        "ingest.outcome": outcome,
      });
    }
  });
});
