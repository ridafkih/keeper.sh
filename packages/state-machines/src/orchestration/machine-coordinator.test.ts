import { describe, expect, it } from "bun:test";
import { IngestionFailureType } from "../ingestion.machine";
import {
  resolveSyncLifecycleEventsFromIngestionOutputs,
  resolveSyncLifecycleEventsFromProvisioningOutputs,
} from "./machine-coordinator";
import { ErrorPolicy } from "../errors/error-policy";

describe("MachineCoordinator", () => {
  it("maps ingestion change outputs to sync lifecycle events", () => {
    const events = resolveSyncLifecycleEventsFromIngestionOutputs([
      { eventsAdded: 1, eventsRemoved: 0, type: "SOURCE_CHANGED" },
    ]);

    expect(events).toEqual([{ type: "INGEST_CHANGED" }]);
  });

  it("maps bootstrap request to manual sync lifecycle event", () => {
    const events = resolveSyncLifecycleEventsFromProvisioningOutputs([
      { mode: "create_single", sourceIds: ["src-1"], type: "BOOTSTRAP_REQUESTED" },
    ]);

    expect(events).toEqual([{ type: "MANUAL_SYNC_REQUESTED" }]);
  });

  it("does not emit sync lifecycle events for unchanged ingestion outputs", () => {
    const events = resolveSyncLifecycleEventsFromIngestionOutputs([
      { type: "SOURCE_UNCHANGED" },
      {
        type: "SOURCE_FAILED",
        code: "provider-auth-failed",
        failureType: IngestionFailureType.AUTH,
        policy: ErrorPolicy.REQUIRES_REAUTH,
      },
    ]);

    expect(events).toEqual([]);
  });
});
