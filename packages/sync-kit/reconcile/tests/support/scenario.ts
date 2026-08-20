import type { Plan } from "../../src/index";
import { planReconciliation } from "../../src/index";
import type { Scenario } from "./apply";
import {
  foreignEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  slotIdentity,
  snapshotListing,
  sourceOnly,
} from "./fixtures";

const planFor = (scenario: Scenario): Plan =>
  planReconciliation(scenario.observed, scenario.known, scenario.mappings, scenario.policy);

const steadyIdentity = slotIdentity(
  "evt-steady",
  "2026-03-10T09:00:00.000Z",
  "2026-03-10T10:00:00.000Z",
);

const steadyScenario = (): Scenario => ({
  observed: sourceOnly(
    snapshotListing({ events: [foreignEvent({ id: "evt-steady", uid: "evt-steady" })] }),
  ),
  known: knownState([knownEvent({ identity: steadyIdentity })]),
  mappings: mappingSet([mapping({ identity: steadyIdentity, destinationId: "mirror-steady" })]),
  policy: policy(),
});

export { planFor, steadyIdentity, steadyScenario };
