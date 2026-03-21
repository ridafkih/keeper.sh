import { describe, expect, it } from "bun:test";
import { createMachineRuntimeWidelogSink } from "./machine-runtime-widelog";

describe("createMachineRuntimeWidelogSink", () => {
  it("writes a fixed set of machine fields with bounded key cardinality", () => {
    const writes = new Map<string, string | number>();
    const uniqueKeys = new Set<string>();
    const sink = createMachineRuntimeWidelogSink("destination_execution", (field, value) => {
      uniqueKeys.add(field);
      writes.set(field, value);
    });

    sink({
      aggregateId: "cal-a",
      outcome: "APPLIED",
      envelope: { id: "env-1", event: { type: "LOCK_ACQUIRED" } },
      snapshot: { state: "locked" },
      transition: {
        commands: [{ type: "EXECUTE" }],
        outputs: [{ type: "EXECUTION_CHANGED" }],
      },
      version: 1,
    });

    sink({
      aggregateId: "cal-b",
      outcome: "CONFLICT_DETECTED",
      envelope: { id: "env-2", event: { type: "EXECUTION_STARTED" } },
      snapshot: { state: "executing" },
      version: 2,
    });

    expect(Array.from(uniqueKeys).sort()).toEqual([
      "machine.destination_execution.aggregate_id",
      "machine.destination_execution.commands_total",
      "machine.destination_execution.conflict_total",
      "machine.destination_execution.duplicate_total",
      "machine.destination_execution.last_envelope_id",
      "machine.destination_execution.last_event_type",
      "machine.destination_execution.last_state",
      "machine.destination_execution.last_version",
      "machine.destination_execution.outputs_total",
      "machine.destination_execution.processed_total",
    ]);
    expect(writes.get("machine.destination_execution.aggregate_id")).toBe("cal-b");
    expect(writes.get("machine.destination_execution.conflict_total")).toBe(1);
    expect(writes.get("machine.destination_execution.processed_total")).toBe(2);
  });
});
