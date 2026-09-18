import type {
  Capabilities,
  InstallationId,
  TimeWindow,
  WindowMembership,
  WritableCalendar,
} from "@keeper.sh/sync-protocol";
import { withinTimeWindow } from "@keeper.sh/sync-ical";
import type { ProvenCoverage } from "./coverage";

interface PlanLimits {
  readonly sampleCount: number;
  readonly sampleBytes: number;
  readonly reassignmentPairingWidth: number;
}

const defaultPlanLimits: PlanLimits = {
  sampleCount: 32,
  sampleBytes: 4096,
  reassignmentPairingWidth: 512,
};

const defaultWindowMembership: WindowMembership = withinTimeWindow;

interface ReconciliationPolicy {
  readonly installation: InstallationId;
  readonly destination: WritableCalendar;
  readonly capabilities: Capabilities;
  readonly mirrorWindow: TimeWindow;
  readonly coverageBySource: ReadonlyMap<string, ProvenCoverage>;
  readonly withinWindow: WindowMembership;
  readonly limits: PlanLimits;
}

export { defaultPlanLimits, defaultWindowMembership };
export type { PlanLimits, ReconciliationPolicy };
