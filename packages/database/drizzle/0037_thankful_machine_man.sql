-- Phase 1: Create new tables
CREATE TABLE "calendar_accounts" (
	"accountId" text,
	"authType" text NOT NULL,
	"caldavCredentialId" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"email" text,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"needsReauthentication" boolean DEFAULT false NOT NULL,
	"oauthCredentialId" uuid,
	"provider" text NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"accountId" uuid NOT NULL,
	"calendarType" text NOT NULL,
	"calendarUrl" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"excludeFocusTime" boolean DEFAULT false NOT NULL,
	"excludeOutOfOffice" boolean DEFAULT false NOT NULL,
	"excludeWorkingLocation" boolean DEFAULT false NOT NULL,
	"externalCalendarId" text,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"syncToken" text,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"url" text,
	"userId" text NOT NULL
);
--> statement-breakpoint
-- Phase 2: Add new columns to oauth_credentials (temporarily nullable for provider/userId)
ALTER TABLE "oauth_credentials" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "oauth_credentials" ADD COLUMN "needsReauthentication" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_credentials" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "oauth_credentials" ADD COLUMN "userId" text;
--> statement-breakpoint
-- Phase 3: Populate oauth_credentials new columns from calendar_destinations
UPDATE "oauth_credentials" oc
SET "provider" = cd."provider", "userId" = cd."userId", "email" = cd."email"
FROM "calendar_destinations" cd
WHERE cd."oauthCredentialId" = oc."id";
--> statement-breakpoint
-- Phase 4: Merge oauth_source_credentials into oauth_credentials
INSERT INTO "oauth_credentials" ("id", "accessToken", "refreshToken", "expiresAt", "email", "needsReauthentication", "provider", "userId", "createdAt", "updatedAt")
SELECT "id", "accessToken", "refreshToken", "expiresAt", "email", "needsReauthentication", "provider", "userId", "createdAt", "updatedAt"
FROM "oauth_source_credentials"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Phase 4.1: Re-run destination backfill for any still-null rows
UPDATE "oauth_credentials" oc
SET "provider" = cd."provider", "userId" = cd."userId", "email" = COALESCE(oc."email", cd."email")
FROM "calendar_destinations" cd
WHERE cd."oauthCredentialId" = oc."id"
  AND (oc."provider" IS NULL OR oc."userId" IS NULL OR oc."email" IS NULL);
--> statement-breakpoint
-- Phase 4.2: Remove orphaned destination credentials with no owner data
DELETE FROM "oauth_credentials" oc
WHERE (oc."provider" IS NULL OR oc."userId" IS NULL)
  AND NOT EXISTS (
    SELECT 1
    FROM "calendar_destinations" cd
    WHERE cd."oauthCredentialId" = oc."id"
  );
--> statement-breakpoint
-- Phase 4.3: Merge caldav_source_credentials into caldav_credentials
WITH source_credential_calendar_urls AS (
  SELECT
    cs."caldavCredentialId" AS "credentialId",
    MIN(cs."calendarUrl") AS "calendarUrl"
  FROM "calendar_sources" cs
  WHERE cs."sourceType" = 'caldav'
    AND cs."caldavCredentialId" IS NOT NULL
  GROUP BY cs."caldavCredentialId"
)
INSERT INTO "caldav_credentials" ("id", "serverUrl", "calendarUrl", "username", "encryptedPassword", "createdAt", "updatedAt")
SELECT
  csc."id",
  csc."serverUrl",
  COALESCE(urls."calendarUrl", csc."serverUrl"),
  csc."username",
  csc."encryptedPassword",
  csc."createdAt",
  csc."updatedAt"
FROM "caldav_source_credentials" csc
LEFT JOIN source_credential_calendar_urls urls ON urls."credentialId" = csc."id"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Phase 5: Make columns NOT NULL (all rows should be populated now)
ALTER TABLE "oauth_credentials" ALTER COLUMN "provider" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_credentials" ALTER COLUMN "userId" SET NOT NULL;
--> statement-breakpoint
-- Phase 6: Data migration — create calendar_accounts + calendars from OAuth destinations
-- Use calendar_destinations.id as calendars.id so all existing FKs resolve automatically
WITH oauth_destination_account_keys AS (
  SELECT
    "userId",
    "provider",
    "accountId",
    "oauthCredentialId",
    "email",
    bool_or("needsReauthentication") AS "needsReauthentication",
    MIN("createdAt") AS "createdAt",
    MAX("updatedAt") AS "updatedAt"
  FROM "calendar_destinations"
  WHERE "oauthCredentialId" IS NOT NULL
  GROUP BY "userId", "provider", "accountId", "oauthCredentialId", "email"
),
dest_accounts AS (
  INSERT INTO "calendar_accounts" ("id", "userId", "provider", "authType", "accountId", "email", "oauthCredentialId", "needsReauthentication", "createdAt", "updatedAt")
  SELECT gen_random_uuid(), "userId", "provider", 'oauth', "accountId", "email", "oauthCredentialId", "needsReauthentication", "createdAt", "updatedAt"
  FROM oauth_destination_account_keys
  RETURNING "id" AS account_id, "userId", "provider", "accountId"
)
INSERT INTO "calendars" ("id", "accountId", "calendarType", "name", "role", "userId", "createdAt", "updatedAt")
SELECT
  cd."id",
  da.account_id,
  'oauth',
  COALESCE(
    NULLIF(btrim(cd."email"), ''),
    NULLIF(btrim(cd."accountId"), ''),
    CASE lower(cd."provider")
      WHEN 'caldav' THEN 'CalDAV'
      WHEN 'icloud' THEN 'iCloud'
      ELSE initcap(replace(replace(cd."provider", '_', ' '), '-', ' '))
    END
  ),
  'destination',
  cd."userId",
  cd."createdAt",
  cd."updatedAt"
FROM "calendar_destinations" cd
JOIN dest_accounts da ON da."userId" = cd."userId" AND da."provider" = cd."provider" AND da."accountId" = cd."accountId"
WHERE cd."oauthCredentialId" IS NOT NULL;
--> statement-breakpoint
-- Phase 7: Data migration — create calendar_accounts + calendars from CalDAV destinations
WITH caldav_destination_account_keys AS (
  SELECT
    "userId",
    "provider",
    "accountId",
    "caldavCredentialId",
    "email",
    bool_or("needsReauthentication") AS "needsReauthentication",
    MIN("createdAt") AS "createdAt",
    MAX("updatedAt") AS "updatedAt"
  FROM "calendar_destinations"
  WHERE "caldavCredentialId" IS NOT NULL
  GROUP BY "userId", "provider", "accountId", "caldavCredentialId", "email"
),
caldav_dest_accounts AS (
  INSERT INTO "calendar_accounts" ("id", "userId", "provider", "authType", "accountId", "email", "caldavCredentialId", "needsReauthentication", "createdAt", "updatedAt")
  SELECT gen_random_uuid(), "userId", "provider", 'caldav', "accountId", "email", "caldavCredentialId", "needsReauthentication", "createdAt", "updatedAt"
  FROM caldav_destination_account_keys
  RETURNING "id" AS account_id, "userId", "provider", "accountId"
)
INSERT INTO "calendars" ("id", "accountId", "calendarType", "calendarUrl", "name", "role", "userId", "createdAt", "updatedAt")
SELECT
  cd."id",
  cda.account_id,
  'caldav',
  cred."calendarUrl",
  COALESCE(
    NULLIF(btrim(cd."email"), ''),
    NULLIF(btrim(cd."accountId"), ''),
    CASE lower(cd."provider")
      WHEN 'caldav' THEN 'CalDAV'
      WHEN 'icloud' THEN 'iCloud'
      ELSE initcap(replace(replace(cd."provider", '_', ' '), '-', ' '))
    END
  ),
  'destination',
  cd."userId",
  cd."createdAt",
  cd."updatedAt"
FROM "calendar_destinations" cd
JOIN caldav_dest_accounts cda ON cda."userId" = cd."userId" AND cda."provider" = cd."provider" AND cda."accountId" = cd."accountId"
LEFT JOIN "caldav_credentials" cred ON cd."caldavCredentialId" = cred."id"
WHERE cd."caldavCredentialId" IS NOT NULL;
--> statement-breakpoint
-- Phase 7.1: Build source calendar ID remap for collisions with destination IDs
CREATE TEMP TABLE "tmp_source_calendar_id_map" AS
SELECT
  cs."id" AS "oldId",
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM "calendars" c
      WHERE c."id" = cs."id"
    ) THEN gen_random_uuid()
    ELSE cs."id"
  END AS "newId"
FROM "calendar_sources" cs;
--> statement-breakpoint
-- Phase 8: Data migration — create calendar_accounts + calendars from OAuth sources
WITH oauth_source_account_keys AS (
  SELECT
    cs."userId",
    COALESCE(cs."provider", 'unknown') AS "provider",
    cs."oauthCredentialId",
    MIN(cs."createdAt") AS "createdAt",
    MAX(cs."updatedAt") AS "updatedAt"
  FROM "calendar_sources" cs
  WHERE cs."sourceType" = 'oauth' AND cs."oauthCredentialId" IS NOT NULL
  GROUP BY cs."userId", COALESCE(cs."provider", 'unknown'), cs."oauthCredentialId"
),
oauth_src_accounts AS (
  INSERT INTO "calendar_accounts" ("id", "userId", "provider", "authType", "oauthCredentialId", "createdAt", "updatedAt")
  SELECT gen_random_uuid(), "userId", "provider", 'oauth', "oauthCredentialId", "createdAt", "updatedAt"
  FROM oauth_source_account_keys
  RETURNING "id" AS account_id, "userId", "provider", "oauthCredentialId"
)
INSERT INTO "calendars" ("id", "accountId", "calendarType", "externalCalendarId", "name", "role", "syncToken", "excludeFocusTime", "excludeOutOfOffice", "excludeWorkingLocation", "userId", "createdAt", "updatedAt")
SELECT id_map."newId", osa.account_id, 'oauth', cs."externalCalendarId", cs."name", 'source', cs."syncToken", cs."excludeFocusTime", cs."excludeOutOfOffice", cs."excludeWorkingLocation", cs."userId", cs."createdAt", cs."updatedAt"
FROM "calendar_sources" cs
JOIN "tmp_source_calendar_id_map" id_map ON id_map."oldId" = cs."id"
JOIN oauth_src_accounts osa ON osa."userId" = cs."userId" AND osa."oauthCredentialId" = cs."oauthCredentialId" AND osa."provider" = COALESCE(cs."provider", 'unknown')
WHERE cs."sourceType" = 'oauth' AND cs."oauthCredentialId" IS NOT NULL;
--> statement-breakpoint
-- Phase 9: Data migration — create calendar_accounts + calendars from CalDAV sources
WITH caldav_source_account_keys AS (
  SELECT
    cs."userId",
    COALESCE(cs."provider", 'caldav') AS "provider",
    cs."caldavCredentialId",
    MIN(cs."createdAt") AS "createdAt",
    MAX(cs."updatedAt") AS "updatedAt"
  FROM "calendar_sources" cs
  JOIN "caldav_credentials" cc ON cc."id" = cs."caldavCredentialId"
  WHERE cs."sourceType" = 'caldav' AND cs."caldavCredentialId" IS NOT NULL
  GROUP BY cs."userId", COALESCE(cs."provider", 'caldav'), cs."caldavCredentialId"
),
caldav_src_accounts AS (
  INSERT INTO "calendar_accounts" ("id", "userId", "provider", "authType", "caldavCredentialId", "createdAt", "updatedAt")
  SELECT gen_random_uuid(), "userId", "provider", 'caldav', "caldavCredentialId", "createdAt", "updatedAt"
  FROM caldav_source_account_keys
  RETURNING "id" AS account_id, "userId", "provider", "caldavCredentialId"
)
INSERT INTO "calendars" ("id", "accountId", "calendarType", "calendarUrl", "name", "role", "syncToken", "userId", "createdAt", "updatedAt")
SELECT id_map."newId", csa.account_id, 'caldav', cs."calendarUrl", cs."name", 'source', cs."syncToken", cs."userId", cs."createdAt", cs."updatedAt"
FROM "calendar_sources" cs
JOIN "tmp_source_calendar_id_map" id_map ON id_map."oldId" = cs."id"
JOIN caldav_src_accounts csa ON csa."userId" = cs."userId" AND csa."caldavCredentialId" = cs."caldavCredentialId" AND csa."provider" = COALESCE(cs."provider", 'caldav')
WHERE cs."sourceType" = 'caldav' AND cs."caldavCredentialId" IS NOT NULL;
--> statement-breakpoint
-- Phase 10: Data migration — create calendar_accounts + calendars from ICS sources
WITH ics_account_keys AS (
  SELECT
    "userId",
    MIN("createdAt") AS "createdAt",
    MAX("updatedAt") AS "updatedAt"
  FROM "calendar_sources"
  WHERE "sourceType" = 'ical'
  GROUP BY "userId"
),
ics_accounts AS (
  INSERT INTO "calendar_accounts" ("id", "userId", "provider", "authType", "createdAt", "updatedAt")
  SELECT gen_random_uuid(), "userId", 'ics', 'none', "createdAt", "updatedAt"
  FROM ics_account_keys
  RETURNING "id" AS account_id, "userId"
)
INSERT INTO "calendars" ("id", "accountId", "calendarType", "name", "role", "url", "syncToken", "userId", "createdAt", "updatedAt")
SELECT id_map."newId", ia.account_id, 'ical', cs."name", 'source', cs."url", cs."syncToken", cs."userId", cs."createdAt", cs."updatedAt"
FROM "calendar_sources" cs
JOIN "tmp_source_calendar_id_map" id_map ON id_map."oldId" = cs."id"
JOIN ics_accounts ia ON ia."userId" = cs."userId"
WHERE cs."sourceType" = 'ical';
--> statement-breakpoint
-- Phase 10.1: Merge duplicate calendar accounts by logical identity
CREATE TEMP TABLE "tmp_calendar_account_id_map" AS
WITH ranked_calendar_accounts AS (
  SELECT
    calendar_account."id" AS "oldAccountId",
    FIRST_VALUE(calendar_account."id") OVER (
      PARTITION BY
        calendar_account."userId",
        calendar_account."provider",
        calendar_account."authType",
        COALESCE(
          NULLIF(lower(btrim(calendar_account."email")), ''),
          NULLIF(lower(btrim(calendar_account."accountId")), ''),
          calendar_account."oauthCredentialId"::text,
          calendar_account."caldavCredentialId"::text,
          calendar_account."id"::text
        )
      ORDER BY calendar_account."updatedAt" DESC, calendar_account."createdAt" DESC, calendar_account."id" DESC
    ) AS "newAccountId"
  FROM "calendar_accounts" calendar_account
)
SELECT "oldAccountId", "newAccountId"
FROM ranked_calendar_accounts
WHERE "oldAccountId" <> "newAccountId";
--> statement-breakpoint
UPDATE "calendar_accounts" canonical
SET
  "accountId" = COALESCE(canonical."accountId", duplicate."accountId"),
  "email" = COALESCE(canonical."email", duplicate."email"),
  "oauthCredentialId" = COALESCE(canonical."oauthCredentialId", duplicate."oauthCredentialId"),
  "caldavCredentialId" = COALESCE(canonical."caldavCredentialId", duplicate."caldavCredentialId"),
  "needsReauthentication" = canonical."needsReauthentication" OR duplicate."needsReauthentication",
  "createdAt" = LEAST(canonical."createdAt", duplicate."createdAt"),
  "updatedAt" = GREATEST(canonical."updatedAt", duplicate."updatedAt")
FROM "tmp_calendar_account_id_map" id_map
JOIN "calendar_accounts" duplicate ON duplicate."id" = id_map."oldAccountId"
WHERE canonical."id" = id_map."newAccountId";
--> statement-breakpoint
UPDATE "calendars" calendar
SET "accountId" = id_map."newAccountId"
FROM "tmp_calendar_account_id_map" id_map
WHERE calendar."accountId" = id_map."oldAccountId";
--> statement-breakpoint
DELETE FROM "calendar_accounts" duplicate_account
USING "tmp_calendar_account_id_map" id_map
WHERE duplicate_account."id" = id_map."oldAccountId";
--> statement-breakpoint
-- Phase 10.2: Update source-linked tables to remapped calendar IDs
UPDATE "calendar_snapshots" cs
SET "sourceId" = id_map."newId"
FROM "tmp_source_calendar_id_map" id_map
WHERE cs."sourceId" = id_map."oldId"
  AND id_map."newId" <> id_map."oldId";
--> statement-breakpoint
UPDATE "event_states" es
SET "sourceId" = id_map."newId"
FROM "tmp_source_calendar_id_map" id_map
WHERE es."sourceId" = id_map."oldId"
  AND id_map."newId" <> id_map."oldId";
--> statement-breakpoint
UPDATE "source_destination_mappings" sdm
SET "sourceId" = id_map."newId"
FROM "tmp_source_calendar_id_map" id_map
WHERE sdm."sourceId" = id_map."oldId"
  AND id_map."newId" <> id_map."oldId";
--> statement-breakpoint
-- Phase 11: Drop old FK constraints
ALTER TABLE "calendar_snapshots" DROP CONSTRAINT IF EXISTS "calendar_snapshots_sourceId_calendar_sources_id_fk";
--> statement-breakpoint
ALTER TABLE "event_mappings" DROP CONSTRAINT IF EXISTS "event_mappings_destinationId_calendar_destinations_id_fk";
--> statement-breakpoint
ALTER TABLE "event_states" DROP CONSTRAINT IF EXISTS "event_states_sourceId_calendar_sources_id_fk";
--> statement-breakpoint
ALTER TABLE "source_destination_mappings" DROP CONSTRAINT IF EXISTS "source_destination_mappings_destinationId_calendar_destinations_id_fk";
--> statement-breakpoint
ALTER TABLE "source_destination_mappings" DROP CONSTRAINT IF EXISTS "source_destination_mappings_sourceId_calendar_sources_id_fk";
--> statement-breakpoint
ALTER TABLE "sync_status" DROP CONSTRAINT IF EXISTS "sync_status_destinationId_calendar_destinations_id_fk";
--> statement-breakpoint
-- Phase 12: Rename FK columns
ALTER TABLE "calendar_snapshots" RENAME COLUMN "sourceId" TO "calendarId";--> statement-breakpoint
ALTER TABLE "event_mappings" RENAME COLUMN "destinationId" TO "calendarId";--> statement-breakpoint
ALTER TABLE "event_states" RENAME COLUMN "sourceId" TO "calendarId";--> statement-breakpoint
ALTER TABLE "source_destination_mappings" RENAME COLUMN "destinationId" TO "destinationCalendarId";--> statement-breakpoint
ALTER TABLE "source_destination_mappings" RENAME COLUMN "sourceId" TO "sourceCalendarId";--> statement-breakpoint
ALTER TABLE "sync_status" RENAME COLUMN "destinationId" TO "calendarId";
--> statement-breakpoint
-- Phase 13: Drop old indexes
DROP INDEX IF EXISTS "event_mappings_event_dest_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "event_mappings_destination_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "event_states_source_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "sync_status_destination_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "event_states_identity_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "source_destination_mapping_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "source_destination_mappings_source_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "source_destination_mappings_destination_idx";
--> statement-breakpoint
-- Phase 14: Drop old tables
ALTER TABLE "caldav_source_credentials" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_destinations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_sources" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_source_credentials" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "caldav_source_credentials" CASCADE;--> statement-breakpoint
DROP TABLE "calendar_destinations" CASCADE;--> statement-breakpoint
DROP TABLE "calendar_sources" CASCADE;--> statement-breakpoint
DROP TABLE "oauth_source_credentials" CASCADE;
--> statement-breakpoint
-- Phase 15: Add new FK constraints
ALTER TABLE "calendar_accounts" ADD CONSTRAINT "calendar_accounts_caldavCredentialId_caldav_credentials_id_fk" FOREIGN KEY ("caldavCredentialId") REFERENCES "public"."caldav_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_accounts" ADD CONSTRAINT "calendar_accounts_oauthCredentialId_oauth_credentials_id_fk" FOREIGN KEY ("oauthCredentialId") REFERENCES "public"."oauth_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_accounts" ADD CONSTRAINT "calendar_accounts_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_accountId_calendar_accounts_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."calendar_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_snapshots" ADD CONSTRAINT "calendar_snapshots_calendarId_calendars_id_fk" FOREIGN KEY ("calendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD CONSTRAINT "event_mappings_calendarId_calendars_id_fk" FOREIGN KEY ("calendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_states" ADD CONSTRAINT "event_states_calendarId_calendars_id_fk" FOREIGN KEY ("calendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_credentials" ADD CONSTRAINT "oauth_credentials_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD CONSTRAINT "source_destination_mappings_destinationCalendarId_calendars_id_fk" FOREIGN KEY ("destinationCalendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD CONSTRAINT "source_destination_mappings_sourceCalendarId_calendars_id_fk" FOREIGN KEY ("sourceCalendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_status" ADD CONSTRAINT "sync_status_calendarId_calendars_id_fk" FOREIGN KEY ("calendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Phase 16: Create new indexes
CREATE INDEX "calendar_accounts_user_idx" ON "calendar_accounts" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "calendar_accounts_provider_idx" ON "calendar_accounts" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "calendars_user_idx" ON "calendars" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "calendars_account_idx" ON "calendars" USING btree ("accountId");--> statement-breakpoint
CREATE INDEX "calendars_role_idx" ON "calendars" USING btree ("role");--> statement-breakpoint
CREATE INDEX "calendars_type_idx" ON "calendars" USING btree ("calendarType");--> statement-breakpoint
CREATE UNIQUE INDEX "event_mappings_event_cal_idx" ON "event_mappings" USING btree ("eventStateId","calendarId");--> statement-breakpoint
CREATE INDEX "event_mappings_calendar_idx" ON "event_mappings" USING btree ("calendarId");--> statement-breakpoint
CREATE INDEX "event_states_calendar_idx" ON "event_states" USING btree ("calendarId");--> statement-breakpoint
CREATE INDEX "oauth_credentials_user_idx" ON "oauth_credentials" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "oauth_credentials_provider_idx" ON "oauth_credentials" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_status_calendar_idx" ON "sync_status" USING btree ("calendarId");--> statement-breakpoint
CREATE UNIQUE INDEX "event_states_identity_idx" ON "event_states" USING btree ("calendarId","sourceEventUid","startTime","endTime");--> statement-breakpoint
CREATE UNIQUE INDEX "source_destination_mapping_idx" ON "source_destination_mappings" USING btree ("sourceCalendarId","destinationCalendarId");--> statement-breakpoint
CREATE INDEX "source_destination_mappings_source_idx" ON "source_destination_mappings" USING btree ("sourceCalendarId");--> statement-breakpoint
CREATE INDEX "source_destination_mappings_destination_idx" ON "source_destination_mappings" USING btree ("destinationCalendarId");
--> statement-breakpoint
-- Phase 17: Drop calendarUrl from caldav_credentials (now lives on calendars table)
ALTER TABLE "caldav_credentials" DROP COLUMN "calendarUrl";
