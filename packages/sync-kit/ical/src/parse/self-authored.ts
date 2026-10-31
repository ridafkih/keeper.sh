import type { InstallationId } from "@keeper.sh/sync-protocol";
import { propertyNamed } from "./event-time";
import type { VeventComponent } from "./parse-calendar";

const provenanceStamp = "X-KEEPER-INSTALLATION";

const isSelfAuthored = (component: VeventComponent, installation: InstallationId): boolean => {
  const stamp = propertyNamed(component, provenanceStamp);
  if (stamp && stamp.value.trim() === installation.value) {
    return true;
  }
  const uid = propertyNamed(component, "UID");
  if (!uid) {
    return false;
  }
  return uid.value.trim().endsWith(`@${installation.value}.keeper.sh`);
};

export { isSelfAuthored, provenanceStamp };
