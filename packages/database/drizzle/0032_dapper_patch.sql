-- Step 1: Create unified calendar_sources table
CREATE TABLE "calendar_sources" (
	"caldavCredentialId" uuid,
	"calendarUrl" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"externalCalendarId" text,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"oauthCredentialId" uuid,
	"provider" text,
	"sourceType" text NOT NULL,
	"syncToken" text,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"url" text,
	"userId" text NOT NULL
);
--> statement-breakpoint
-- Step 2: Add FK constraints to calendar_sources
ALTER TABLE "calendar_sources" ADD CONSTRAINT "calendar_sources_caldavCredentialId_caldav_source_credentials_id_fk" FOREIGN KEY ("caldavCredentialId") REFERENCES "public"."caldav_source_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD CONSTRAINT "calendar_sources_oauthCredentialId_oauth_source_credentials_id_fk" FOREIGN KEY ("oauthCredentialId") REFERENCES "public"."oauth_source_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD CONSTRAINT "calendar_sources_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Step 3: Create indexes on calendar_sources
CREATE INDEX "calendar_sources_user_idx" ON "calendar_sources" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "calendar_sources_type_idx" ON "calendar_sources" USING btree ("sourceType");--> statement-breakpoint
CREATE INDEX "calendar_sources_provider_idx" ON "calendar_sources" USING btree ("provider");--> statement-breakpoint
-- Step 4: Migrate ICS sources (preserve IDs for FK integrity)
INSERT INTO "calendar_sources" ("id", "userId", "sourceType", "name", "url", "createdAt", "updatedAt")
SELECT "id", "userId", 'ical', "name", "url", "createdAt", "createdAt"
FROM "remote_ical_sources";
--> statement-breakpoint
-- Step 5: Migrate OAuth sources (preserve IDs)
INSERT INTO "calendar_sources" ("id", "userId", "sourceType", "provider", "name", "externalCalendarId", "oauthCredentialId", "syncToken", "createdAt", "updatedAt")
SELECT "id", "userId", 'oauth', "provider", "name", "externalCalendarId", "oauthSourceCredentialId", "syncToken", "createdAt", COALESCE("updatedAt", "createdAt")
FROM "oauth_calendar_sources";
--> statement-breakpoint
-- Step 6: Migrate CalDAV sources (preserve IDs)
INSERT INTO "calendar_sources" ("id", "userId", "sourceType", "provider", "name", "calendarUrl", "caldavCredentialId", "syncToken", "createdAt", "updatedAt")
SELECT "id", "userId", 'caldav', "provider", "name", "calendarUrl", "credentialId", "syncToken", "createdAt", COALESCE("updatedAt", "createdAt")
FROM "caldav_sources";
--> statement-breakpoint
-- Step 7: Drop old FK constraints (data already migrated, IDs preserved)
ALTER TABLE "event_states" DROP CONSTRAINT "event_states_sourceId_remote_ical_sources_id_fk";
--> statement-breakpoint
ALTER TABLE "source_destination_mappings" DROP CONSTRAINT "source_destination_mappings_sourceId_remote_ical_sources_id_fk";
--> statement-breakpoint
-- Step 8: Add new FK constraints pointing to calendar_sources
ALTER TABLE "event_states" ADD CONSTRAINT "event_states_sourceId_calendar_sources_id_fk" FOREIGN KEY ("sourceId") REFERENCES "public"."calendar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD CONSTRAINT "source_destination_mappings_sourceId_calendar_sources_id_fk" FOREIGN KEY ("sourceId") REFERENCES "public"."calendar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_states_source_idx" ON "event_states" USING btree ("sourceId");
--> statement-breakpoint
-- Step 9: Migrate OAuth event states into event_states
INSERT INTO "event_states" ("sourceId", "sourceEventUid", "startTime", "endTime", "createdAt")
SELECT "oauthSourceId", "sourceEventUid", "startTime", "endTime", "createdAt"
FROM "oauth_event_states";
--> statement-breakpoint
-- Step 10: Migrate CalDAV event states into event_states
INSERT INTO "event_states" ("sourceId", "sourceEventUid", "startTime", "endTime", "createdAt")
SELECT "caldavSourceId", "sourceEventUid", "startTime", "endTime", "createdAt"
FROM "caldav_event_states";
--> statement-breakpoint
-- Step 11: Merge OAuth source-destination mappings
INSERT INTO "source_destination_mappings" ("sourceId", "destinationId", "createdAt")
SELECT "oauthSourceId", "destinationId", "createdAt"
FROM "oauth_source_destination_mappings"
ON CONFLICT ("sourceId", "destinationId") DO NOTHING;
--> statement-breakpoint
-- Step 12: Merge CalDAV source-destination mappings
INSERT INTO "source_destination_mappings" ("sourceId", "destinationId", "createdAt")
SELECT "caldavSourceId", "destinationId", "createdAt"
FROM "caldav_source_destination_mappings"
ON CONFLICT ("sourceId", "destinationId") DO NOTHING;
--> statement-breakpoint
-- Step 13: Migrate OAuth event mappings (join to find unified event_states IDs)
INSERT INTO "event_mappings" ("eventStateId", "destinationId", "destinationEventUid", "deleteIdentifier", "startTime", "endTime", "createdAt")
SELECT es."id", oem."destinationId", oem."destinationEventUid", oem."deleteIdentifier", oem."startTime", oem."endTime", oem."createdAt"
FROM "oauth_event_mappings" oem
JOIN "oauth_event_states" oes ON oes."id" = oem."oauthEventStateId"
JOIN "event_states" es ON es."sourceId" = oes."oauthSourceId"
  AND es."sourceEventUid" = oes."sourceEventUid"
  AND es."startTime" = oes."startTime"
  AND es."endTime" = oes."endTime"
ON CONFLICT ("eventStateId", "destinationId") DO NOTHING;
--> statement-breakpoint
-- Step 14: Migrate CalDAV event mappings
INSERT INTO "event_mappings" ("eventStateId", "destinationId", "destinationEventUid", "deleteIdentifier", "startTime", "endTime", "createdAt")
SELECT es."id", cem."destinationId", cem."destinationEventUid", cem."deleteIdentifier", cem."startTime", cem."endTime", cem."createdAt"
FROM "caldav_event_mappings" cem
JOIN "caldav_event_states" ces ON ces."id" = cem."caldavEventStateId"
JOIN "event_states" es ON es."sourceId" = ces."caldavSourceId"
  AND es."sourceEventUid" = ces."sourceEventUid"
  AND es."startTime" = ces."startTime"
  AND es."endTime" = ces."endTime"
ON CONFLICT ("eventStateId", "destinationId") DO NOTHING;