import type { ChangeListing } from "@keeper.sh/sync-protocol";

type ObservedState =
  | { readonly kind: "sourceOnly"; readonly source: ChangeListing; readonly destination?: never }
  | { readonly kind: "bothSides"; readonly source: ChangeListing; readonly destination: ChangeListing };

export type { ObservedState };
