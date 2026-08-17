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
import { createMicrosoftContract } from "../../src/contract";
import { createFakeGraph } from "./fake-graph";
import {
  decadeWindow,
  microsoftAccount,
  microsoftCalendar,
  microsoftDependenciesOver,
  scopeOver,
  suiteStart,
} from "./harness";

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
  contract: ProviderContract<"microsoft">,
  environment: ConformanceEnvironment,
  writeLog: WriteLogEntry[],
): ProviderContract<"microsoft">["provider"]["write"] =>
  async (
    intent: WriteIntent<"microsoft">,
    context: OperationContext,
  ): Promise<Result<WriteOutcome>> => {
    const answered = await contract.provider.write(intent, context);
    if (answered.ok) {
      writeLog.push({ at: environment.clock.now(), intent, outcome: answered.value });
    }
    return answered;
  };

const createMicrosoftUnderTest = (
  environment: ConformanceEnvironment,
): Promise<ProviderUnderTest<"microsoft">> => {
  const fake = createFakeGraph({
    installation: environment.installation,
    account: microsoftAccount.value,
    calendarId: microsoftCalendar.calendar.value,
    startedAt: suiteStart.value,
  });
  const dependencies = microsoftDependenciesOver(environment, fake);
  const contract = createMicrosoftContract(dependencies);
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
      return Promise.resolve();
    },
    inspect,
    dispose: () => Promise.resolve(),
  });
};

export { createMicrosoftUnderTest };
