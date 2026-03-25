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
  OAuthSourceProvider,
  type FetchEventsResult,
  type ProcessEventsOptions,
} from "./core/oauth/source-provider";
export {
  OAUTH_SYNC_WINDOW_VERSION,
  getOAuthSyncWindow,
  getOAuthSyncWindowStart,
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
export { generateEventUid, isKeeperEvent } from "./core/events/identity";
export { inferAllDayEvent, resolveIsAllDayEvent } from "./core/events/all-day";
export { RateLimiter, type RateLimiterConfig } from "./core/utils/rate-limiter";
export { createRedisRateLimiter, type RedisRateLimiter, type RedisRateLimiterConfig } from "./core/utils/redis-rate-limiter";
export { allSettledWithConcurrency, type AllSettledWithConcurrencyOptions } from "./core/utils/concurrency";
export { getErrorMessage } from "./core/utils/error";
export { getEventsForDestination } from "./core/events/events";
export {
  buildSourceEventIdentityKey,
  buildSourceEventsToAdd,
  buildSourceEventStateIdsToRemove,
  type ExistingSourceEventState,
  type SourceEventDiffOptions,
} from "./core/source/event-diff";
export {
  filterSourceEventsToSyncWindow,
  resolveSourceSyncTokenAction,
  splitSourceEventsByStorageIdentity,
  type OAuthSyncWindow,
  type SourceEventsInWindowResult,
  type SourceEventStoragePartition,
  type SourceSyncTokenAction,
} from "./core/source/sync-diagnostics";
export {
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
  type GoogleOAuthCredentials,
  type GoogleOAuthService,
} from "./core/oauth/google";
export {
  createMicrosoftOAuthService,
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
export type {
  IngestSourceOptions,
  IngestionResult,
  IngestionChanges,
  ExistingEventState,
  FetchEventsResult as IngestionFetchEventsResult,
} from "./core/sync-engine/ingest";
