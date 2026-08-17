import type { ProviderContract } from "@keeper.sh/sync-protocol";
import { microsoftConformanceObligations } from "./conformance-obligations";
import type { MicrosoftDependencies } from "./dependencies";
import { microsoftFingerprintContract } from "./fingerprint";
import { createMicrosoftInternals } from "./internals";

const createMicrosoftContract = (
  dependencies: MicrosoftDependencies,
): ProviderContract<"microsoft"> => {
  const internals = createMicrosoftInternals(dependencies);
  return {
    provider: internals.provider,
    fingerprint: microsoftFingerprintContract,
    conformance: microsoftConformanceObligations({
      dependencies,
      requests: internals.requests,
      permits: internals.permits,
      inFlightKeys: internals.inFlightKeys,
      deletionCalendars: internals.deletionCalendars,
    }),
  };
};

export { createMicrosoftContract };
