import type { Instant, WindowMembership } from "@keeper.sh/sync-protocol";
import type { PlanLimits } from "@keeper.sh/sync-reconcile";
import type { ShadowLimits } from "./catalog/limits";
import type { PlanUnit } from "./plan-unit";

interface ShadowOptions {
  readonly asOf: Instant;
  readonly maxCoverageAgeSeconds: number;
  readonly withinWindow: WindowMembership;
  readonly limits: ShadowLimits;
  readonly planLimits: PlanLimits;
  readonly plan: PlanUnit;
}

export type { ShadowOptions };
