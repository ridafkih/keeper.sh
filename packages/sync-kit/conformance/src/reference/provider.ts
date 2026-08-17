import type { ConformanceEnvironment, ProviderUnderTest } from "../options";
import { createReference } from "./build";
import { referenceCalendar, referenceWritableCalendar } from "./calendar";

const createReferenceProvider = (
  environment: ConformanceEnvironment,
): Promise<ProviderUnderTest<"reference">> =>
  Promise.resolve(createReference({ environment, defect: null }));

export { createReferenceProvider, referenceCalendar, referenceWritableCalendar };
