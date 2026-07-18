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
  createCoordinatedRefresher,
  type CoordinatedRefresherOptions,
} from "./core/oauth/coordinated-refresher";
export {
  OAuthSourceProvider,
  type FetchEventsResult,
  type ProcessEventsOptions,
} from "./core/oauth/source-provider";
export {
  OAUTH_SYNC_WINDOW_VERSION,
  getOAuthSyncTokenVersion,
  getOAuthSyncWindow,
  getOAuthSyncWindowStart,
  type OAuthSyncWindow,
} from "./core/oauth/sync-window";
export {
  decodeStoredSyncToken,
  encodeStoredSyncToken,
  resolveSyncTokenForWindow,
} from "./core/oauth/sync-token";
export {
  createOAuthSourceProvider,
  type CreateOAuthSourceProviderOptions,
  type OAuthSourceAccount,
  type SourceProvider,
} from "./core/oauth/create-source-provider";
export { generateDeterministicEventUid, isKeeperEvent } from "./core/events/identity";
export { inferAllDayEvent, resolveIsAllDayEvent } from "./core/events/all-day";
export { RateLimiter, type RateLimiterConfig } from "./core/utils/rate-limiter";
export { createRedisRateLimiter, type RedisRateLimiter, type RedisRateLimiterConfig } from "./core/utils/redis-rate-limiter";
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
  getEventsForDestination,
  getMappedSourceCalendarIds,
} from "./core/events/events";
export {
  assertSourceRecurrenceMaterializationWithinBudget,
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
  getUserEventsForSync,
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
  SourceSyncResult,
  OAuthSourceConfig,
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
  getSourceProvider,
  type SourceProvidersConfig,
} from "./utils/registry/server";

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
export { buildSourceEventInstanceKey } from "./core/source/event-instance";
export type {
  IngestSourceOptions,
  IngestionResult,
  IngestionChanges,
  IngestionPersistence,
  IngestionPersistenceWork,
  CalendarSnapshotChange,
  FetchEventsResult as IngestionFetchEventsResult,
} from "./core/sync-engine/ingest";
