import type { Plan, SourceIdentity } from "@keeper.sh/sync-reconcile";
import type { Catalog, DeletionEntry, DestinationSyncInput, ShadowOptions } from "../../src/index";
import { catalogShadowRun } from "../../src/index";
import {
  inHistoric,
  mirrorRow,
  ownMirrorEvent,
  destinationSnapshot,
  shadowOptions,
  slotIdentity,
  storedSourceEvent,
  syncInput,
} from "./fixtures";

type CatalogedCatalog = Extract<Catalog, { kind: "cataloged" }>;

const cataloged = (catalog: Catalog): CatalogedCatalog => {
  if (catalog.kind !== "cataloged") {
    throw new Error(`expected a cataloged run, got ${catalog.kind}`);
  }
  return catalog;
};

const runShadow = (input: DestinationSyncInput, options: ShadowOptions = shadowOptions()): Catalog =>
  catalogShadowRun(input, options);

const deletionsOfRun = (
  input: DestinationSyncInput,
  options: ShadowOptions = shadowOptions(),
): readonly DeletionEntry[] => cataloged(runShadow(input, options)).deletions;

const steadyIdentity = slotIdentity(
  "evt-steady",
  "2026-03-10T09:00:00.000Z",
  "2026-03-10T10:00:00.000Z",
);

const steadyInput = (): DestinationSyncInput =>
  syncInput({
    storedSourceEvents: [storedSourceEvent({ identity: steadyIdentity })],
    mirrors: [mirrorRow({ identity: steadyIdentity })],
    destinationListing: destinationSnapshot({
      events: [
        ownMirrorEvent({
          id: "mirror-evt-steady",
          uid: "evt-steady",
          time: inHistoric,
        }),
      ],
    }),
  });

const inputOver = (identities: readonly SourceIdentity[]): DestinationSyncInput =>
  syncInput({
    storedSourceEvents: identities.map((identity) => storedSourceEvent({ identity })),
    mirrors: identities.map((identity) =>
      mirrorRow({
        identity,
        destinationId: `mirror-${identity.uid.value}`,
        destinationHandle: `handle-${identity.uid.value}`,
      }),
    ),
    destinationListing: destinationSnapshot({
      events: identities.map((identity) =>
        ownMirrorEvent({
          id: `mirror-${identity.uid.value}`,
          uid: identity.uid.value,
          deleteHandle: `handle-${identity.uid.value}`,
        }),
      ),
    }),
  });

const catalogOfPlan = (identities: readonly SourceIdentity[], plan: Plan): Catalog =>
  runShadow(inputOver(identities), shadowOptions({ plan: () => plan }));

const at = <Item>(items: readonly Item[], index: number): Item => {
  const found = items.slice(index, index + 1);
  for (const item of found) {
    return item;
  }
  throw new Error(`expected an item at index ${index} of ${items.length}`);
};

const firstOf = <Item>(items: readonly Item[]): Item => at(items, 0);

export {
  at,
  catalogOfPlan,
  cataloged,
  deletionsOfRun,
  firstOf,
  inputOver,
  runShadow,
  steadyIdentity,
  steadyInput,
};
export type { CatalogedCatalog };
