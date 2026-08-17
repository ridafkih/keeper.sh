import type { ZoneCache } from "@keeper.sh/sync-ical";
import type { RequestSeam } from "../client/request";
import type { MicrosoftDependencies } from "../dependencies";

interface WriteSurroundings {
  readonly dependencies: MicrosoftDependencies;
  readonly requests: RequestSeam;
  readonly zones: ZoneCache;
}

export type { WriteSurroundings };
