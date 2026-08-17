import type { Plan } from "@keeper.sh/sync-reconcile";
import { planReconciliation } from "@keeper.sh/sync-reconcile";
import type { TranslationUnit } from "./translate/unit";

type PlanUnit = (unit: TranslationUnit) => Plan;

const planUnitWithReconciliation: PlanUnit = (unit) =>
  planReconciliation(unit.observed, unit.known, unit.mappings, unit.policy);

export { planUnitWithReconciliation };
export type { PlanUnit };
