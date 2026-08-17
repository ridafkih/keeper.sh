import type {
  ConformanceEnvironment,
  ProviderInspection,
  ProviderSeed,
  ProviderUnderTest,
  WriteLogEntry,
} from "@keeper.sh/sync-conformance";
import type {
  OperationContext,
  ProviderContract,
  RemoteEvent,
  Result,
  WriteIntent,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import { caldavConformanceObligations } from "../../src/conformance-obligations";
import { caldavFingerprintContract } from "../../src/fingerprint";
import { createCalDAVInternals } from "../../src/internals";
import { providerOver } from "../../src/provider";
import { createFakeCalDAV } from "./fake-caldav";
import { caldavDependenciesOver, decadeWindow, scopeOver } from "./harness";

const inspectionContext = (environment: ConformanceEnvironment): OperationContext => {
  const now = environment.clock.now();
  return {
    signal: new AbortController().signal,
    now: environment.clock.now,
    deadline: { kind: "instant", value: new Date(Date.parse(now.value) + 5000).toISOString() },
    retryBudget: { maxAttempts: 1, retryDelayCeilingMs: 1 },
  };
};

const recordingWrite = (
  contract: ProviderContract<"caldav">,
  environment: ConformanceEnvironment,
  writeLog: WriteLogEntry[],
): ProviderContract<"caldav">["provider"]["write"] =>
  async (
    intent: WriteIntent<"caldav">,
    context: OperationContext,
  ): Promise<Result<WriteOutcome>> => {
    const answered = await contract.provider.write(intent, context);
    if (answered.ok) {
      writeLog.push({ at: environment.clock.now(), intent, outcome: answered.value });
    }
    return answered;
  };

const createCalDAVUnderTest = (
  environment: ConformanceEnvironment,
): Promise<ProviderUnderTest<"caldav">> => {
  const fake = createFakeCalDAV();
  const dependencies = caldavDependenciesOver(environment, fake);
  const internals = createCalDAVInternals(dependencies);
  const contract: ProviderContract<"caldav"> = {
    provider: providerOver(internals),
    fingerprint: caldavFingerprintContract,
    conformance: caldavConformanceObligations(internals),
  };
  const writeLog: WriteLogEntry[] = [];

  const objects = async (): Promise<readonly RemoteEvent[]> => {
    const listed = await contract.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      inspectionContext(environment),
    );
    if (!listed.ok) {
      return [];
    }
    return listed.value.events ?? [];
  };

  const inspect = async (): Promise<ProviderInspection> => ({
    objects: await objects(),
    writeLog: [...writeLog],
  });

  return Promise.resolve({
    contract: {
      provider: {
        capabilities: contract.provider.capabilities,
        listCalendars: contract.provider.listCalendars,
        listChanges: contract.provider.listChanges,
        normalize: contract.provider.normalize,
        write: recordingWrite(contract, environment, writeLog),
      },
      fingerprint: contract.fingerprint,
      conformance: contract.conformance,
    },
    seed: (seed: ProviderSeed) => {
      fake.seedFromProvider(seed);
      internals.reported.corrupt(seed.corruptKnownRows);
      return Promise.resolve();
    },
    inspect,
    dispose: () => Promise.resolve(),
  });
};

export { createCalDAVUnderTest };
