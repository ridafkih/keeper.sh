import type { InstallationId, Provenance } from "@keeper.sh/sync-protocol";
import type { Event as GraphEvent } from "@microsoft/microsoft-graph-types";
import { extendedPropertyValue, namedProperty } from "./extended-property";

const provenancePropertyName = namedProperty("installation");
const provenanceCategory = "Keeper.sh";

const carriesOurCategory = (event: GraphEvent): boolean => {
  const { categories } = event;
  if (!Array.isArray(categories)) {
    return false;
  }
  return categories.some((category) => category === provenanceCategory);
};

const readProvenance = (event: GraphEvent, installation: InstallationId): Provenance => {
  const stamped = extendedPropertyValue(event, provenancePropertyName);
  if (stamped === installation.value) {
    return { kind: "ours", installation };
  }
  if (stamped !== null) {
    return { kind: "ours", installation: { kind: "installationId", value: stamped } };
  }
  if (carriesOurCategory(event)) {
    return { kind: "indeterminate" };
  }
  return { kind: "foreign" };
};

export { provenanceCategory, provenancePropertyName, readProvenance };
