import type { IngestionOutput } from "../ingestion.machine";
import type { SourceProvisioningOutput } from "../source-provisioning.machine";
import type { SyncLifecycleEvent } from "../sync-lifecycle.machine";

const resolveSyncLifecycleEventsFromIngestionOutputs = (
  outputs: IngestionOutput[],
): SyncLifecycleEvent[] => {
  const events: SyncLifecycleEvent[] = [];

  for (const output of outputs) {
    if (output.type === "SOURCE_CHANGED") {
      events.push({ type: "INGEST_CHANGED" });
    }
  }

  return events;
};

const resolveSyncLifecycleEventsFromProvisioningOutputs = (
  outputs: SourceProvisioningOutput[],
): SyncLifecycleEvent[] => {
  const events: SyncLifecycleEvent[] = [];

  for (const output of outputs) {
    if (output.type === "BOOTSTRAP_REQUESTED") {
      events.push({ type: "MANUAL_SYNC_REQUESTED" });
    }
  }

  return events;
};

export {
  resolveSyncLifecycleEventsFromIngestionOutputs,
  resolveSyncLifecycleEventsFromProvisioningOutputs,
};
