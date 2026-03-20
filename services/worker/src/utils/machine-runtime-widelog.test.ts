import { describe, expect, it } from "bun:test";
import { createMachineRuntimeWidelogSink } from "./machine-runtime-widelog";

describe("machine runtime widelog sink", () => {
  it("aggregates counters and writes latest machine fields", () => {
    const writes = new Map<string, unknown>();
    const sink = createMachineRuntimeWidelogSink("destination_execution", (field, value) => {
      writes.set(field, value);
    });

    sink({
      aggregateId: "cal-1",
      outcome: "APPLIED",
      envelope: {
        event: { type: "EXECUTION_STARTED" },
        id: "env-1",
      },
      snapshot: { state: "executing" },
      transition: {
        commands: [{ type: "EMIT_SYNC_EVENT" }],
        outputs: [{ type: "EXECUTION_CHANGED" }],
      },
      version: 1,
    });

    sink({
      aggregateId: "cal-1",
      outcome: "DUPLICATE_IGNORED",
      envelope: {
        event: { type: "EXECUTION_STARTED" },
        id: "env-1",
      },
      snapshot: { state: "executing" },
      version: 1,
    });

    expect(writes.get("machine.destination_execution.processed_total")).toBe(2);
    expect(writes.get("machine.destination_execution.duplicate_total")).toBe(1);
    expect(writes.get("machine.destination_execution.conflict_total")).toBe(0);
    expect(writes.get("machine.destination_execution.commands_total")).toBe(1);
    expect(writes.get("machine.destination_execution.outputs_total")).toBe(1);
    expect(writes.get("machine.destination_execution.last_envelope_id")).toBe("env-1");
    expect(writes.get("machine.destination_execution.last_event_type")).toBe("EXECUTION_STARTED");
    expect(writes.get("machine.destination_execution.last_state")).toBe("executing");
    expect(writes.get("machine.destination_execution.last_version")).toBe(1);
    expect(writes.get("machine.destination_execution.aggregate_id")).toBe("cal-1");
  });
});
