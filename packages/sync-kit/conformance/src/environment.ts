import type { InstallationId, Instant } from "@keeper.sh/sync-protocol";
import { createTestClock } from "./clock";
import { conformanceLimits } from "./limits";
import type { ConformanceEnvironment } from "./options";
import { createTransportStub } from "./transport";

interface EnvironmentOptions {
  readonly start: Instant;
  readonly installation: InstallationId;
  readonly hash: (input: string) => string;
}

const createConformanceEnvironment = (options: EnvironmentOptions): ConformanceEnvironment => ({
  clock: createTestClock({ start: options.start }),
  concurrency: conformanceLimits.concurrency,
  hash: options.hash,
  installation: options.installation,
  transport: createTransportStub(),
});

export { createConformanceEnvironment };
export type { EnvironmentOptions };
