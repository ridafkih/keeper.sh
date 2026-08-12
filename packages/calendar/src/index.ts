export {
  createOAuthProviders,
  type ValidatedState,
  type AuthorizationUrlOptions,
  type NormalizedUserInfo,
  type OAuthTokens,
  type OAuthProvider,
  type OAuthProvidersConfig,
  type OAuthProviders,
  type OAuthStateStore,
} from "./core/oauth/providers";
export {
  buildOAuthConfigs,
  type OAuthCredentials,
  type OAuthEnv,
  type OAuthConfigs,
} from "./core/oauth/config";
export {
  type OAuthRefreshResult,
  type OAuthTokenProvider,
} from "./core/oauth/token-provider";
export {
  ensureValidToken,
  type TokenState,
  type TokenRefresher,
} from "./core/oauth/ensure-valid-token";
export {
  runWithCredentialRefreshLock,
  type RefreshLockStore,
} from "./core/oauth/refresh-coordinator";
export { isOAuthReauthRequiredError } from "./core/oauth/error-classification";
export {
  buildReauthenticationDemandFields,
  resolveReauthenticationDemandAction,
  type ReauthenticationDemandAction,
  type ReauthenticationDemandFields,
  type ReauthenticationDemandFieldsParams,
} from "./core/reauthentication/demand-telemetry";
export {
  createCoordinatedRefresher,
  type CoordinatedRefresherOptions,
} from "./core/oauth/coordinated-refresher";
export {
  OAUTH_SYNC_WINDOW_VERSION,
  getOAuthSyncTokenVersion,
} from "./core/oauth/sync-window";
export {
  decodeStoredSyncToken,
  encodeStoredSyncToken,
  resolveSyncTokenForWindow,
} from "./core/oauth/sync-token";
export { generateDeterministicEventUid, isKeeperEvent } from "./core/events/identity";
export { inferAllDayEvent, resolveIsAllDayEvent } from "./core/events/all-day";
export {
  type EventTimeRange,
  overlapsRepresentableTimeWindow,
  overlapsTimeWindow,
  REPRESENTABLE_RANGE_SLACK_MS,
  resolvePointInTimeRange,
  resolveRepresentableTimeRange,
  resolveWholeDayTimeRange,
} from "./core/events/time-range";
export {
  instantToWallTime,
  resolveTimeZone,
  wallTimeToInstant,
} from "./ics/utils/timezone-instant";
export { RateLimiter, type RateLimiterConfig } from "./core/utils/rate-limiter";
export { createGoogleUserRateLimiter, createRedisRateLimiter, type RedisRateLimiter, type RedisRateLimiterConfig } from "./core/utils/redis-rate-limiter";
export { allSettledWithConcurrency, type AllSettledWithConcurrencyOptions } from "./core/utils/concurrency";
export { getErrorMessage } from "./core/utils/error";
export {
  buildCalendarBackoffState,
  RESET_CALENDAR_BACKOFF_STATE,
  type CalendarBackoffState,
} from "./core/utils/calendar-backoff";
export {
  RequestTimeoutError,
  fetchWithTimeout,
  buildTimeoutSignal,
  isTimeoutError,
  mergeAbortSignals,
} from "./core/utils/fetch-with-timeout";
export {
  getEventsForCalendars,
  getEventsForCalendarsWithDiagnostics,
  getEventsForDestination,
  getMappedSourceCalendarIds,
  shouldExcludeSyncEvent,
  type DestinationEventReadDiagnostics,
  type DestinationEventReadResult,
} from "./core/events/events";
export {
  findSourceEventsExceedingRecurrenceBudget,
  materializeRecurrenceEvents,
  RecurrenceMaterializationLimitError,
  type RecurrenceMaterializationOptions,
  type RecurrenceMaterializationWindow,
} from "./core/events/recurrence-materializer";
export {
  parseStoredIcsExceptionDates,
  parseStoredIcsRecurrence,
  parseStoredIcsRecurrenceRule,
  parseStoredRecurrenceForMaterialization,
  type MaterializedRecurrenceFields,
  type ParsedStoredRecurrenceRule,
  type StoredRecurrenceMaterializationInput,
} from "./core/events/stored-recurrence";
export {
  buildSourceEventIdentityKey,
  buildSourceEventsToAdd,
  buildSourceEventStateIdsToRemove,
  type ExistingSourceEventState,
  type SourceEventDiffOptions,
} from "./core/source/event-diff";
export {
  planCalendarRediscovery,
  resolveRediscoveryCalendarType,
  toDiscoveredCalDAVCalendars,
  toDiscoveredGoogleCalendars,
  toDiscoveredOutlookCalendars,
  toExistingCalendars,
  type CalendarRediscoveryPlan,
  type CalendarRetarget,
  type DiscoveredCalendar,
  type ExistingCalendar,
  type RediscoveryCalendarType,
  type StoredCalendarRow,
} from "./core/source/calendar-rediscovery";
export {
  isCalendarListFailure,
  isProviderAuthFailure,
  isProviderTokenRefreshFailure,
} from "./core/source/rediscovery-failures";
export {
  applyCalendarRediscoveryPlan,
  markCalendarRediscoveryAttempt,
  type CalendarRediscoveryApplyInput,
  type CalendarRediscoveryApplyResult,
  type InsertedCalendar,
} from "./core/source/apply-calendar-rediscovery";
export {
  SOURCE_INGEST_LOCK_NAMESPACE,
  SOURCE_INGEST_LOCK_TIMEOUT_MS,
  withSourceIngestLock,
  withSourceIngestLocks,
} from "./core/source/ingest-lock";
export {
  parseStoredSourceEventState,
  parseStoredSourceEventStates,
  type StoredSourceEventState,
} from "./core/source/stored-event-state";
export {
  filterSourceEventsToSyncWindow,
  resolveSourceSyncTokenAction,
  splitSourceEventsByPersistenceIdentity,
  type SourceEventsInWindowResult,
  type SourceEventStoragePartition,
  type SourceSyncTokenAction,
} from "./core/source/sync-diagnostics";
export {
  buildEventStateInsertRow,
  insertEventStatesWithConflictResolution,
  type EventStateInsertRow,
  type EventStateInsertClient,
} from "./core/source/write-event-states";
export { computeSyncOperations } from "./core/sync/operations";
export type { ReconciliationScope } from "./core/sync/operations";
export {
  DEFAULT_FUTURE_SYNC_RANGE,
  DEFAULT_HISTORIC_SYNC_RANGE,
  createSyncWindow,
  createSourceIngestionPlan,
  getConfigurableSyncWindow,
  getSyncRangeOrder,
  getWiderSyncRange,
  intersectSyncWindows,
  type SourceIngestionPlan,
  type SyncWindow,
} from "./core/sync/sync-range";
export {
  BASE_SOURCE_SYNC_RANGES,
  createRequiredSourceRanges,
  type RequiredSourceRanges,
  type StoredDestinationRanges,
} from "./core/sync/required-source-ranges";
export {
  type DestinationSyncResult,
  type SyncProgressUpdate,
  type SyncStage,
} from "./core/sync/types";
export {
  SyncAggregateTracker,
  type SyncAggregateSnapshot,
  type SyncAggregateMessage,
  type SyncAggregateTrackerConfig,
} from "./core/sync/aggregate-tracker";
export {
  createSyncAggregateRuntime,
  type SyncAggregateRuntimeConfig,
  type SyncAggregateRuntime,
} from "./core/sync/aggregate-runtime";
export {
  getEventMappingsForDestination,
  createEventMapping,
  deleteEventMapping,
  type EventMapping,
} from "./core/events/mappings";
export {
  getOAuthAccountsByPlan,
  getOAuthAccountsForUser,
  type OAuthAccount,
} from "./core/oauth/accounts";
export {
  createGoogleOAuthService,
  createGoogleTokenRefresher,
  type GoogleOAuthCredentials,
  type GoogleOAuthService,
} from "./core/oauth/google";
export {
  createMicrosoftOAuthService,
  createMicrosoftTokenRefresher,
  type MicrosoftOAuthCredentials,
  type MicrosoftOAuthService,
} from "./core/oauth/microsoft";
export {
  generateState,
  validateState,
} from "./core/oauth/state";
export type {
  AuthType,
  CalDAVProviderConfig,
  ProviderCapabilities,
  ProviderDefinition,
  SourcePreferenceOption,
  SourcePreferencesConfig,
  MaterializedSyncableEvent,
  SyncableEvent,
  PushResult,
  DeleteResult,
  SyncResult,
  RemoteEvent,
  EventAvailability,
  ProviderConfig,
  OAuthProviderConfig,
  GoogleCalendarConfig,
  OutlookCalendarConfig,
  CalDAVConfig,
  ListRemoteEventsOptions,
  BroadcastSyncStatus,
  SourceEvent,
  SyncOperation,
} from "./core/types";

export {
  PROVIDER_DEFINITIONS,
  getProvider,
  getProvidersByAuthType,
  getOAuthProviders,
  getCalDAVProviders,
  isCalDAVProvider,
  isOAuthProvider,
  isProviderId,
  getActiveProviders,
} from "./utils/registry/registry";
export type {
  ProviderId,
  OAuthProviderId,
  CalDAVProviderId,
  OAuthProviderDefinition,
  CalDAVProviderDefinition,
} from "./utils/registry/registry";

export {
  executeRemoteOperations,
  syncCalendar,
} from "./core/sync-engine";
export type {
  CalendarSyncProvider,
  PendingChanges,
  SyncCalendarOptions,
} from "./core/sync-engine";
export { createRedisGenerationCheck } from "./core/sync-engine/generation";
export type { GenerationStore } from "./core/sync-engine/generation";
export { createDatabaseFlush } from "./core/sync-engine/flush";
export { ingestSource } from "./core/sync-engine/ingest";
export {
  JOB_OWNED_WIDE_EVENT_KEYS,
  selectIngestWideEventFields,
} from "./core/sync-engine/ingest-wide-event";
export { buildSourceEventInstanceKey } from "./core/source/event-instance";
export type {
  IngestSourceOptions,
  IngestionResult,
  IngestionChanges,
  IngestionPersistence,
  IngestionPersistenceWork,
  CalendarSnapshotChange,
  DiscardedSourceEventCounts,
  IngestWideEventFields,
  FetchEventsResult as IngestionFetchEventsResult,
} from "./core/sync-engine/ingest";
