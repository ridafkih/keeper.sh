import type { ProviderContract } from "@keeper.sh/sync-protocol";
import { caldavConformanceObligations } from "./conformance-obligations";
import type { CalDAVDependencies } from "./dependencies";
import { caldavFingerprintContract } from "./fingerprint";
import { createCalDAVInternals } from "./internals";
import { providerOver } from "./provider";

const createCalDAVContract = (dependencies: CalDAVDependencies): ProviderContract<"caldav"> => {
  const internals = createCalDAVInternals(dependencies);
  return {
    provider: providerOver(internals),
    fingerprint: caldavFingerprintContract,
    conformance: caldavConformanceObligations(internals),
  };
};

export { createCalDAVContract };
