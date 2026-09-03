import type { InstallationId, RemoteEvent } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";

const provenanceDispositions = [
  "ourMirror",
  "foreignInstallation",
  "external",
  "indeterminate",
] as const;
type ProvenanceDisposition = (typeof provenanceDispositions)[number];

const classifyProvenance = (
  event: RemoteEvent,
  installation: InstallationId,
): ProvenanceDisposition => {
  const { provenance } = event;
  switch (provenance.kind) {
    case "foreign": {
      return "external";
    }
    case "indeterminate": {
      return "indeterminate";
    }
    case "ours": {
      if (provenance.installation.value === installation.value) {
        return "ourMirror";
      }
      return "foreignInstallation";
    }
    default: {
      return assertNever(provenance);
    }
  }
};

const isRetirable = (event: RemoteEvent, installation: InstallationId): boolean =>
  classifyProvenance(event, installation) === "ourMirror";

export { classifyProvenance, isRetirable, provenanceDispositions };
export type { ProvenanceDisposition };
