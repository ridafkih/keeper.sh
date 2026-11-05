import type { ConformanceCaseId } from "../case-id";
import type { ConformanceEnvironment, ProviderUnderTest } from "../options";
import { createReference } from "./build";

const createMutantReferenceProvider = (
  environment: ConformanceEnvironment,
  defect: ConformanceCaseId,
): Promise<ProviderUnderTest<"reference">> =>
  Promise.resolve(createReference({ environment, defect }));

export { createMutantReferenceProvider };
