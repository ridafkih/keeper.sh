import type { GoogleDependencies } from "../dependencies";
import type { RequestSeam } from "../client/request";
import type { MintedEventIds } from "./minted-ids";

interface WriteSurroundings {
  readonly dependencies: GoogleDependencies;
  readonly requests: RequestSeam;
  readonly mintedIds: MintedEventIds;
}

export type { WriteSurroundings };
