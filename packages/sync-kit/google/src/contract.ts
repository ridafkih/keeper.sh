import type { ProviderContract } from "@keeper.sh/sync-protocol";
import { googleConformanceObligations } from "./conformance-obligations";
import type { GoogleDependencies } from "./dependencies";
import { googleFingerprintContract } from "./fingerprint";
import { createGoogleInternals } from "./internals";

const createGoogleContract = (dependencies: GoogleDependencies): ProviderContract<"google"> => {
  const internals = createGoogleInternals(dependencies);
  return {
    provider: internals.provider,
    fingerprint: googleFingerprintContract,
    conformance: googleConformanceObligations({
      dependencies,
      requests: internals.requests,
      permits: internals.permits,
      inFlightKeys: internals.inFlightKeys,
      deletionCalendars: internals.deletionCalendars,
    }),
  };
};

export { createGoogleContract };
