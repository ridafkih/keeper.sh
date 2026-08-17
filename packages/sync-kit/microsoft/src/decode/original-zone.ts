import type { ZoneCache } from "@keeper.sh/sync-ical";
import type { ZoneReading } from "./zone";
import { resolveGraphZone } from "./zone";

interface ZoneCandidates {
  readonly originalStartTimeZone: string | null;
  readonly responseTimeZone: string | null;
}

const resolveOriginalZone = (candidates: ZoneCandidates, zones: ZoneCache): ZoneReading => {
  const original = resolveGraphZone(candidates.originalStartTimeZone, zones);
  if (original.kind === "resolved") {
    return original;
  }
  const response = resolveGraphZone(candidates.responseTimeZone, zones);
  if (response.kind === "resolved") {
    return response;
  }
  return original;
};

export { resolveOriginalZone };
export type { ZoneCandidates };
