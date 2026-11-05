export { conformanceHash, planConformanceRun, runConformance } from "./run-conformance";
export type { ConformanceRunPlan, PlannedCase } from "./run-conformance";

export { caseIdsCitedBy, conformanceCaseIds, ledgerEntryOf } from "./case-id";
export type { ConformanceCaseId, LedgerEntryId } from "./case-id";

export { ConformanceViolation } from "./violation";
export type { ViolationDetail } from "./violation";

export { ungatedCaseIds } from "./report";
export type { ConformanceReport, SelectedCase } from "./report";

export type {
  ConformanceEnvironment,
  CreateProvider,
  ProviderInspection,
  ProviderSeed,
  ProviderUnderTest,
  RunConformanceOptions,
  SuiteRunner,
  TestClock,
  TransportBehaviour,
  TransportStub,
  WriteLogEntry,
} from "./options";

export { createTestClock } from "./clock";
export type { TestClockOptions } from "./clock";

export { createConformanceEnvironment } from "./environment";
export type { EnvironmentOptions } from "./environment";

export { conformanceLimits } from "./limits";
export type { ConformanceLimits } from "./limits";

export { canonicalise, sortedKeys } from "./canonical";
export type { CanonicalValue } from "./canonical";

export { conformanceCaseOf, selectConformanceCases } from "./registry/suite";
export type { CaseSelection } from "./registry/suite";
export type { CaseContext, CaseFamily, CaseGate, ConformanceCase } from "./registry/case";

export { assertNoRemovalDerivable, derivableRemovals } from "./assertions/no-removal";
export type { KnownIdentity, KnownMirror, RemovalBasis } from "./assertions/no-removal";
export {
  assertCoverageProven,
  assertCursorWithheld,
  assertNoContentInDiagnostics,
  assertNotSnapshotUnderTruncation,
} from "./assertions/listing";
export {
  assertConflictNotOverwrite,
  assertNoUnplannedRecreation,
  assertNoUnconditionalWrite,
} from "./assertions/outcome";

export { createReferenceProvider, referenceCalendar } from "./reference/provider";
export { createMutantReferenceProvider } from "./reference/mutants";
export { referenceCapabilities, referenceMinimumSpanSeconds } from "./reference/capabilities";

export {
  composeDecorators,
  conflictingOn,
  expiringCursorAfter,
  stallingOn,
  truncatingAfter,
  undecorated,
} from "./fixtures";
export type { ProviderDecorator } from "./fixtures";
