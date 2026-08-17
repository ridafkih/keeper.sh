import type { calendar_v3 } from "@googleapis/calendar";
import type { InstallationId, Provenance } from "@keeper.sh/sync-protocol";

const provenancePropertyKey = "keeper.sh/installation";

interface ProvenanceInputs {
  readonly installation: InstallationId;
  readonly deterministicIds: ReadonlySet<string>;
}

const stampedInstallation = (item: calendar_v3.Schema$Event): string | null =>
  item.extendedProperties?.private?.[provenancePropertyKey] ?? null;

const carriesOurId = (item: calendar_v3.Schema$Event, inputs: ProvenanceInputs): boolean => {
  if (typeof item.id !== "string") {
    return false;
  }
  return inputs.deterministicIds.has(item.id);
};

const carriesNoProperties = (item: calendar_v3.Schema$Event): boolean =>
  (item.extendedProperties?.private ?? null) === null;

const cannotCarryAStamp = (item: calendar_v3.Schema$Event): boolean =>
  item.status === "cancelled" && carriesNoProperties(item);

const decodeProvenance = (
  item: calendar_v3.Schema$Event,
  inputs: ProvenanceInputs,
): Provenance => {
  const stamped = stampedInstallation(item);
  if (stamped === inputs.installation.value) {
    return { kind: "ours", installation: inputs.installation };
  }
  if (carriesOurId(item, inputs)) {
    return { kind: "ours", installation: inputs.installation };
  }
  if (stamped !== null) {
    return { kind: "foreign" };
  }
  if (cannotCarryAStamp(item)) {
    return { kind: "indeterminate" };
  }
  return { kind: "foreign" };
};

export { decodeProvenance, provenancePropertyKey };
export type { ProvenanceInputs };
