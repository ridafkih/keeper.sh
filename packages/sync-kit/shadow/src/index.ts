export { ShadowInternalDataError } from "./errors";

export { compareCanonicalUtcInstants, isCanonicalUtcInstant } from "./time/instant";
export { epochMillisecondsOf, secondsBetween } from "./time/epoch";

export { coverageProofRefusals, sourceCoverageFrom } from "./input/stored-coverage";
export type {
  CoverageProofRefusal,
  CoverageProofRequest,
  SourceCoverageProof,
  StoredSourceCoverage,
} from "./input/stored-coverage";

export {
  countsAgreeWithTheWithheldList,
  readIsComplete,
  withheldFromSource,
  withheldTotalOf,
  withholdingCounters,
} from "./input/read-completeness";
export type {
  LocalReadCompleteness,
  WithheldSourceEvent,
  WithholdingCounter,
} from "./input/read-completeness";

export type { SourceReadWitness } from "./input/read-witness";
export type {
  DestinationNormalizationWitness,
  DestinationSyncInput,
  MirrorRow,
  StoredSourceEvent,
} from "./input/destination-sync-input";

export type { ShadowOptions } from "./options";
export { planUnitWithReconciliation } from "./plan-unit";
export type { PlanUnit } from "./plan-unit";

export { translationRefusals } from "./translate/refusal";
export type { TranslationRefusal } from "./translate/refusal";
export { decodeStoredCanonicalEvent } from "./translate/decode";
export type { DecodeStoredEvent, StoredDecoding } from "./translate/decode";
export { synthesizeSourceListing } from "./translate/listing";
export type { SourceListingRequest, SynthesizedSourceListing } from "./translate/listing";
export { buildKnownState } from "./translate/known";
export type { KnownStateRequest } from "./translate/known";
export { buildMappingSet } from "./translate/mappings";
export type { MappingSetRequest } from "./translate/mappings";
export { buildObservedState } from "./translate/observed";
export type { ObservedStateRequest } from "./translate/observed";
export { buildPolicy } from "./translate/policy";
export type { PolicyRequest } from "./translate/policy";
export { partitionBySourceCalendar } from "./translate/partition";
export type { PartitionRequest, SourcePartition } from "./translate/partition";
export { translateDestinationSync } from "./translate/translate";
export type { Translation, TranslationUnit } from "./translate/unit";

export { defaultShadowLimits, truncationMarker } from "./catalog/limits";
export type { ShadowLimits } from "./catalog/limits";
export { catalogCaveats, deleteHandleSources, deletionOrigins } from "./catalog/entries";
export type {
  CatalogCaveat,
  CoverageVerdict,
  CreationEntry,
  DeleteHandleSource,
  DeletionEntry,
  DeletionOrigin,
  EntryTime,
  ForgottenRowEntry,
  RecurrenceIdentity,
  ReplacementEntry,
  UnresolvedEntry,
  UpdateEntry,
} from "./catalog/entries";
export { deletionsOf, forgottenRowsOf } from "./catalog/deletions";
export { creationsOf, replacementsOf, updatesOf } from "./catalog/writes";
export { unresolvedOf } from "./catalog/unresolved";
export { boundedIdentifiers, boundedSampleOf } from "./catalog/sample";
export type { BoundedIdentifiers } from "./catalog/sample";
export { inSignatureOrder, signatureOf } from "./catalog/order";
export { recurrenceIdentityOf } from "./catalog/recurrence";
export { catalogTranslation } from "./catalog/catalog";
export type { Catalog } from "./catalog/catalog";
export { renderCatalog } from "./catalog/render";
export type { LoggableCatalog, LoggableValue } from "./catalog/render";

export { catalogShadowRun } from "./shadow-run";
