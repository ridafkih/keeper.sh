import { describe, expect, it } from "bun:test";
import { createMachineRuntimeWidelogSink } from "./machine-runtime-widelog";

describe("machine runtime widelog sink", () => {
  it("aggregates counters and writes latest machine fields", () => {
    const writes = new Map<string, unknown>();
    const sink = createMachineRuntimeWidelogSink("source_ingestion_lifecycle", (field, value) => {
      writes.set(field, value);
    });

    sink({
      aggregateId: "source-1",
      outcome: "APPLIED",
      envelope: {
        event: { type: "SOURCE_SELECTED" },
        id: "env-1",
      },
      snapshot: { state: "source_selected" },
      transition: {
        commands: [{ type: "PERSIST_SYNC_TOKEN" }],
        outputs: [{ type: "INGEST_CHANGED" }],
      },
      version: 2,
    });

    sink({
      aggregateId: "source-1",
      outcome: "CONFLICT_DETECTED",
      envelope: {
        event: { type: "FETCHER_RESOLVED" },
        id: "env-2",
      },
      snapshot: { state: "source_selected" },
      version: 3,
    });

    expect(writes.get("machine.source_ingestion_lifecycle.processed_total")).toBe(2);
    expect(writes.get("machine.source_ingestion_lifecycle.duplicate_total")).toBe(0);
    expect(writes.get("machine.source_ingestion_lifecycle.conflict_total")).toBe(1);
    expect(writes.get("machine.source_ingestion_lifecycle.commands_total")).toBe(1);
    expect(writes.get("machine.source_ingestion_lifecycle.outputs_total")).toBe(1);
    expect(writes.get("machine.source_ingestion_lifecycle.last_envelope_id")).toBe("env-2");
    expect(writes.get("machine.source_ingestion_lifecycle.last_event_type")).toBe("FETCHER_RESOLVED");
    expect(writes.get("machine.source_ingestion_lifecycle.last_state")).toBe("source_selected");
    expect(writes.get("machine.source_ingestion_lifecycle.last_version")).toBe(3);
    expect(writes.get("machine.source_ingestion_lifecycle.aggregate_id")).toBe("source-1");
  });
});
