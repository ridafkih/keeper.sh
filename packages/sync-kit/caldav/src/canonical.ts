import type { IcsOptions, SelfAuthoredPolicy } from "@keeper.sh/sync-ical";
import { defaultIcsLimits } from "@keeper.sh/sync-ical";
import type { CalDAVDependencies } from "./dependencies";
import { caldavIcsPatches } from "./text/extended-date-time";

const caldavIcsOptions = (
  dependencies: CalDAVDependencies,
  selfAuthored: SelfAuthoredPolicy = "includeForRoundTrip",
): IcsOptions => ({
  limits: defaultIcsLimits,
  patches: caldavIcsPatches,
  zones: dependencies.zones,
  installation: dependencies.installation,
  selfAuthored,
});

const compareCodeUnits = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

export { caldavIcsOptions, compareCodeUnits };
