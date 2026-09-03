import type { InstallationId } from "@keeper.sh/sync-protocol";
import type { IcsPatch } from "./text/patch";
import type { ZoneCache } from "./zone/zone-cache";

interface IcsLimits {
  readonly maxBytes: number;
  readonly maxContentLines: number;
  readonly maxComponentDepth: number;
  readonly maxPropertyValues: number;
  readonly maxExceptionDates: number;
  readonly maxDescriptionDepth: number;
  readonly maxDiagnosticSample: number;
  readonly zoneProjectionYears: number;
}

const defaultIcsLimits: IcsLimits = {
  maxBytes: 8_000_000,
  maxContentLines: 200_000,
  maxComponentDepth: 32,
  maxPropertyValues: 2000,
  maxExceptionDates: 750,
  maxDescriptionDepth: 64,
  maxDiagnosticSample: 20,
  zoneProjectionYears: 30,
};

const selfAuthoredPolicies = ["exclude", "includeForRoundTrip"] as const;
type SelfAuthoredPolicy = (typeof selfAuthoredPolicies)[number];

interface IcsOptions {
  readonly limits: IcsLimits;
  readonly patches: readonly IcsPatch[];
  readonly zones: ZoneCache;
  readonly installation: InstallationId;
  readonly selfAuthored: SelfAuthoredPolicy;
}

export { defaultIcsLimits, selfAuthoredPolicies };
export type { IcsLimits, IcsOptions, SelfAuthoredPolicy };
