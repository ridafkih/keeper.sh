export { CalendarProvider } from "./core/sync/provider";
export {
  createOAuthProviders,
  configureStateStore,
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
  OAuthCalendarProvider,
  type OAuthRefreshResult,
  type OAuthTokenProvider,
  type AuthErrorResult,
} from "./core/oauth/provider";
export {
  type RefreshLockStore,
} from "./core/oauth/refresh-coordinator";
export {
  createOAuthDestinationProvider,
  type CreateOAuthProviderOptions,
} from "./core/oauth/create-provider";
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
export { allSettledWithConcurrency, type AllSettledWithConcurrencyOptions } from "./core/utils/concurrency";
export { getErrorMessage } from "./core/utils/error";
export { widelogger } from "widelogger";
export type { WideloggerOptions } from "widelogger";
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
export { syncDestinationsForUser, type DestinationProvider } from "./core/sync/destinations";
export { computeSyncOperations } from "./core/sync/operations";
export {
  createSyncCoordinator,
  type SyncContext,
  type SyncCoordinator,
  type SyncCoordinatorConfig,
  type DestinationSyncResult,
  type SyncProgressUpdate,
  type SyncStage,
} from "./core/sync/coordinator";
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
  createInMemoryStateStore,
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
  createDestinationProviders,
  getSourceProvider,
  type DestinationProvidersConfig,
  type SourceProvidersConfig,
} from "./utils/registry/server";
