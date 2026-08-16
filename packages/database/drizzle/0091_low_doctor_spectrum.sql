-- Every value here is UTC wall clock: the application writes UTC, and the columns
-- carrying DEFAULT now() were written by a server whose time zone the migration runner
-- asserts is UTC before it gets here. The ALTERs are deliberately bare — with the
-- session in UTC the conversion is binary-identical, so Postgres records it as metadata
-- and skips the rewrite. Adding USING would force a full rewrite of every table under
-- ACCESS EXCLUSIVE, and would still be wrong for the defaulted columns on a server
-- whose zone was never UTC.
ALTER TABLE "api_tokens" ALTER COLUMN "lastUsedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_tokens" ALTER COLUMN "expiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_tokens" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_tokens" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "caldav_credentials" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "caldav_credentials" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "caldav_credentials" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "caldav_credentials" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "calendar_accounts" ALTER COLUMN "calendarsRefreshAttemptedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_accounts" ALTER COLUMN "calendarsRefreshedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_accounts" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_accounts" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "calendar_accounts" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_accounts" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "calendar_push_channels" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_push_channels" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "calendar_push_channels" ALTER COLUMN "expiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_push_channels" ALTER COLUMN "lastFailureAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_push_channels" ALTER COLUMN "lastNotificationAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_push_channels" ALTER COLUMN "nextAttemptAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_push_channels" ALTER COLUMN "reauthorizeRequestedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_push_channels" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_push_channels" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "calendar_push_channels" ALTER COLUMN "verifiedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_snapshots" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_snapshots" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "lastFailureAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "nextAttemptAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "ingestLastFailureAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "ingestNextAttemptAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "ingestLastSucceededAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "ingestWindowEnd" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "ingestWindowRecordedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "ingestWindowStart" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "unavailableSince" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "event_mappings" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_mappings" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "event_mappings" ALTER COLUMN "destinationEndTime" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_mappings" ALTER COLUMN "destinationStartTime" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_mappings" ALTER COLUMN "endTime" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_mappings" ALTER COLUMN "missingFirstObservedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_mappings" ALTER COLUMN "startTime" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_mappings" ALTER COLUMN "writeBackDailyWindowStart" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_mappings" ALTER COLUMN "writeBackEpochWindowStart" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_mappings" ALTER COLUMN "writeBackLastAppliedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_states" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_states" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "event_states" ALTER COLUMN "endTime" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_states" ALTER COLUMN "recurrenceId" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_states" ALTER COLUMN "startTime" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_write_back_tombstones" ALTER COLUMN "appliedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_write_back_tombstones" ALTER COLUMN "appliedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "event_write_back_tombstones" ALTER COLUMN "expiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_write_back_tombstones" ALTER COLUMN "observedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ical_feed_calendars" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ical_feed_calendars" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ical_feed_settings" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ical_feed_settings" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ical_feeds" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ical_feeds" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ical_feeds" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ical_feeds" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "oauth_credentials" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_credentials" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "oauth_credentials" ALTER COLUMN "expiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_credentials" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_credentials" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ALTER COLUMN "copiesMissingObservedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ALTER COLUMN "deleteConfirmationApprovedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ALTER COLUMN "lastHealthyReadAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ALTER COLUMN "writeBackEnabledAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_status" ALTER COLUMN "lastSyncedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_status" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_status" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user_events" ALTER COLUMN "startTime" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_events" ALTER COLUMN "endTime" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_events" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_events" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user_events" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_events" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user_subscriptions" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user_sync_requests" ALTER COLUMN "requestedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_sync_requests" ALTER COLUMN "requestedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "accessTokenExpiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "refreshTokenExpiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "jwks" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jwks" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "jwks" ALTER COLUMN "expiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ALTER COLUMN "expiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "oauth_application" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_application" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "oauth_application" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_application" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "oauth_application" ALTER COLUMN "expiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_consent" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_consent" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "oauth_consent" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_consent" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ALTER COLUMN "expiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ALTER COLUMN "revoked" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ALTER COLUMN "authTime" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "passkey" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "expiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "expiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "updatedAt" SET DEFAULT now();