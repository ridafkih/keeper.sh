import type { Capabilities, ProviderId } from "@keeper.sh/sync-protocol";
import type { ConformanceCaseId } from "../../src/case-id";
import { createConformanceEnvironment } from "../../src/environment";
import type { ProviderDecorator } from "../../src/fixtures";
import { undecorated } from "../../src/fixtures";
import type { ConformanceEnvironment, ProviderUnderTest } from "../../src/options";
import { createMutantReferenceProvider } from "../../src/reference/mutants";
import { referenceCapabilities } from "../../src/reference/capabilities";
import { createReferenceProvider } from "../../src/reference/provider";
import { conformanceCaseOf, selectConformanceCases } from "../../src/registry/suite";
import { installation, instant, isInsideWindow } from "./protocol";

const suiteStart = instant("2026-03-11T00:00:00.000Z");

const countingHash = (input: string): string =>
  `h${input.length}:${new Bun.CryptoHasher("sha256").update(input).digest("hex").slice(0, 16)}`;

const collidingHash = (input: string): string => `collides:${input.length}`;

const environmentFor = (): ConformanceEnvironment =>
  createConformanceEnvironment({
    start: suiteStart,
    installation,
    hash: countingHash,
  });

interface ReferenceHarness {
  readonly environment: ConformanceEnvironment;
  readonly provider: ProviderUnderTest<"reference">;
  readonly supports: Capabilities<"reference">;
  readonly dispose: () => Promise<void>;
}

const referenceHarness = async (
  decorate: ProviderDecorator = undecorated,
): Promise<ReferenceHarness> => {
  const environment = environmentFor();
  const provider = decorate(await createReferenceProvider(environment));
  return {
    environment,
    provider,
    supports: referenceCapabilities,
    dispose: () => provider.dispose(),
  };
};

const runCaseAgainst = async <Provider extends ProviderId>(
  id: ConformanceCaseId,
  provider: ProviderUnderTest<Provider>,
  environment: ConformanceEnvironment,
  supports: Capabilities<Provider>,
): Promise<void> => {
  const record = conformanceCaseOf(id, supports);
  await record.run({ provider, environment, supports, withinWindow: isInsideWindow });
};

const runReferenceCase = async (
  id: ConformanceCaseId,
  decorate: ProviderDecorator = undecorated,
): Promise<void> => {
  const harness = await referenceHarness(decorate);
  try {
    await runCaseAgainst(id, harness.provider, harness.environment, harness.supports);
  } finally {
    await harness.dispose();
  }
};

interface MutantOutcome {
  readonly failed: readonly ConformanceCaseId[];
}

const runSuiteAgainst = async (
  provider: ProviderUnderTest<"reference">,
  environment: ConformanceEnvironment,
): Promise<MutantOutcome> => {
  const selection = selectConformanceCases(referenceCapabilities);
  const failed: ConformanceCaseId[] = [];
  try {
    for (const record of selection.selected) {
      const outcome = await record
        .run({
          provider,
          environment,
          supports: referenceCapabilities,
          withinWindow: isInsideWindow,
        })
        .then(() => "passed")
        .catch(() => "failed");
      if (outcome === "failed") {
        failed.push(record.id);
      }
    }
  } finally {
    await provider.dispose();
  }
  return { failed };
};

const runSuiteAgainstMutant = async (defect: ConformanceCaseId): Promise<MutantOutcome> => {
  const environment = environmentFor();
  return runSuiteAgainst(await createMutantReferenceProvider(environment, defect), environment);
};

const runSuiteAgainstUnmutatedReference = async (): Promise<MutantOutcome> => {
  const environment = environmentFor();
  return runSuiteAgainst(await createReferenceProvider(environment), environment);
};

export {
  collidingHash,
  countingHash,
  environmentFor,
  referenceHarness,
  runCaseAgainst,
  runReferenceCase,
  runSuiteAgainstMutant,
  runSuiteAgainstUnmutatedReference,
  suiteStart,
};
export type { MutantOutcome, ReferenceHarness };
