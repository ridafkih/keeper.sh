import type { InstallationId } from "@keeper.sh/sync-protocol";
import { createZoneCache } from "../../src/index";
import { defaultIcsLimits, defaultIcsPatches } from "../../src/index";
import type { IcsLimits, IcsOptions, SelfAuthoredPolicy } from "../../src/index";

const testInstallation: InstallationId = { kind: "installationId", value: "inst-test" };

interface TestOptionOverrides {
  readonly limits?: Partial<IcsLimits>;
  readonly selfAuthored?: SelfAuthoredPolicy;
  readonly installation?: InstallationId;
}

const testLimits = (overrides: Partial<IcsLimits> = {}): IcsLimits => ({
  ...defaultIcsLimits,
  ...overrides,
});

const testOptions = (overrides: TestOptionOverrides = {}): IcsOptions => ({
  limits: testLimits(overrides.limits),
  patches: defaultIcsPatches,
  zones: createZoneCache(),
  installation: overrides.installation ?? testInstallation,
  selfAuthored: overrides.selfAuthored ?? "exclude",
});

export { testInstallation, testLimits, testOptions };
export type { TestOptionOverrides };
