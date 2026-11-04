ALTER TABLE "source_ingest_schedule" SET (fillfactor = 70);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "source_ingest_schedule_track_calendar"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW."disabled" AND 'pull' = ANY(NEW."capabilities") THEN
    INSERT INTO "source_ingest_schedule" ("calendarId", "dueAt")
    VALUES (NEW."id", now())
    ON CONFLICT ("calendarId") DO UPDATE
      SET
        "dueAt" = now(),
        "parkedReason" = NULL,
        "releaseSeq" = "source_ingest_schedule"."releaseSeq" + 1,
        "updatedAt" = now()
      WHERE "source_ingest_schedule"."parkedReason" = 'ineligible';
  ELSE
    INSERT INTO "source_ingest_schedule" ("calendarId", "dueAt", "parkedReason")
    VALUES (NEW."id", NULL, 'ineligible')
    ON CONFLICT ("calendarId") DO UPDATE
      SET
        "dueAt" = NULL,
        "parkedReason" = 'ineligible',
        "releaseSeq" = "source_ingest_schedule"."releaseSeq" + 1,
        "updatedAt" = now()
      WHERE "source_ingest_schedule"."parkedReason" IS DISTINCT FROM 'ineligible';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "calendars_source_ingest_schedule_insert" ON "calendars";
--> statement-breakpoint
CREATE TRIGGER "calendars_source_ingest_schedule_insert"
AFTER INSERT ON "calendars"
FOR EACH ROW EXECUTE FUNCTION "source_ingest_schedule_track_calendar"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "calendars_source_ingest_schedule_eligibility" ON "calendars";
--> statement-breakpoint
CREATE TRIGGER "calendars_source_ingest_schedule_eligibility"
AFTER UPDATE OF "disabled", "capabilities" ON "calendars"
FOR EACH ROW
WHEN (OLD."disabled" IS DISTINCT FROM NEW."disabled" OR OLD."capabilities" IS DISTINCT FROM NEW."capabilities")
EXECUTE FUNCTION "source_ingest_schedule_track_calendar"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "source_ingest_schedule_release_account"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "source_ingest_schedule"
  SET
    "dueAt" = now(),
    "parkedReason" = NULL,
    "failureCount" = 0,
    "releaseSeq" = "releaseSeq" + 1,
    "updatedAt" = now()
  WHERE ("parkedReason" = 'credential-rejected' OR "failureCount" > 0)
    AND "calendarId" IN (SELECT "id" FROM "calendars" WHERE "accountId" = NEW."id");
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "calendar_accounts_source_ingest_schedule_reauthenticated" ON "calendar_accounts";
--> statement-breakpoint
CREATE TRIGGER "calendar_accounts_source_ingest_schedule_reauthenticated"
AFTER UPDATE OF "needsReauthentication" ON "calendar_accounts"
FOR EACH ROW
WHEN (OLD."needsReauthentication" AND NOT NEW."needsReauthentication")
EXECUTE FUNCTION "source_ingest_schedule_release_account"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "source_ingest_schedule_release_credential"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "source_ingest_schedule"
  SET
    "dueAt" = now(),
    "parkedReason" = NULL,
    "failureCount" = 0,
    "releaseSeq" = "releaseSeq" + 1,
    "updatedAt" = now()
  WHERE "parkedReason" = 'credential-rejected'
    AND "calendarId" IN (
      SELECT "calendars"."id"
      FROM "calendars"
      INNER JOIN "calendar_accounts" ON "calendar_accounts"."id" = "calendars"."accountId"
      WHERE "calendar_accounts"."oauthCredentialId" = NEW."id"
    );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "oauth_credentials_source_ingest_schedule_reissued" ON "oauth_credentials";
--> statement-breakpoint
CREATE TRIGGER "oauth_credentials_source_ingest_schedule_reissued"
AFTER UPDATE OF "refreshToken" ON "oauth_credentials"
FOR EACH ROW
WHEN (OLD."refreshToken" IS DISTINCT FROM NEW."refreshToken")
EXECUTE FUNCTION "source_ingest_schedule_release_credential"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "source_ingest_schedule_release_caldav_credential"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "source_ingest_schedule"
  SET
    "dueAt" = now(),
    "parkedReason" = NULL,
    "failureCount" = 0,
    "releaseSeq" = "releaseSeq" + 1,
    "updatedAt" = now()
  WHERE ("parkedReason" = 'credential-rejected' OR "failureCount" > 0)
    AND "calendarId" IN (
      SELECT "calendars"."id"
      FROM "calendars"
      INNER JOIN "calendar_accounts" ON "calendar_accounts"."id" = "calendars"."accountId"
      WHERE "calendar_accounts"."caldavCredentialId" = NEW."id"
    );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "caldav_credentials_source_ingest_schedule_changed" ON "caldav_credentials";
--> statement-breakpoint
CREATE TRIGGER "caldav_credentials_source_ingest_schedule_changed"
AFTER UPDATE OF "encryptedPassword", "username", "serverUrl", "authMethod" ON "caldav_credentials"
FOR EACH ROW
WHEN (
  OLD."encryptedPassword" IS DISTINCT FROM NEW."encryptedPassword"
  OR OLD."username" IS DISTINCT FROM NEW."username"
  OR OLD."serverUrl" IS DISTINCT FROM NEW."serverUrl"
  OR OLD."authMethod" IS DISTINCT FROM NEW."authMethod"
)
EXECUTE FUNCTION "source_ingest_schedule_release_caldav_credential"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "source_ingest_schedule_wake_user"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "source_ingest_schedule"
  SET
    "wakeDueAt" = LEAST(COALESCE("wakeDueAt", now()), now()),
    "wakeReceivedAt" = COALESCE("wakeReceivedAt", now()),
    "wakeSeq" = "wakeSeq" + 1,
    "updatedAt" = now()
  WHERE "dueAt" IS NOT NULL
    AND "calendarId" IN (SELECT "id" FROM "calendars" WHERE "userId" = NEW."userId");
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "session_source_ingest_schedule_sign_in" ON "session";
--> statement-breakpoint
CREATE TRIGGER "session_source_ingest_schedule_sign_in"
AFTER INSERT ON "session"
FOR EACH ROW EXECUTE FUNCTION "source_ingest_schedule_wake_user"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "source_ingest_schedule_wake_mapped_source"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "source_ingest_schedule"
  SET
    "wakeDueAt" = LEAST(COALESCE("wakeDueAt", now()), now()),
    "wakeReceivedAt" = COALESCE("wakeReceivedAt", now()),
    "wakeSeq" = "wakeSeq" + 1,
    "updatedAt" = now()
  WHERE "dueAt" IS NOT NULL AND "calendarId" = NEW."sourceCalendarId";
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "source_ingest_schedule_wake_published_calendar"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "source_ingest_schedule"
  SET
    "wakeDueAt" = LEAST(COALESCE("wakeDueAt", now()), now()),
    "wakeReceivedAt" = COALESCE("wakeReceivedAt", now()),
    "wakeSeq" = "wakeSeq" + 1,
    "updatedAt" = now()
  WHERE "dueAt" IS NOT NULL AND "calendarId" = NEW."calendarId";
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "source_destination_mappings_source_ingest_schedule_mapped" ON "source_destination_mappings";
--> statement-breakpoint
CREATE TRIGGER "source_destination_mappings_source_ingest_schedule_mapped"
AFTER INSERT ON "source_destination_mappings"
FOR EACH ROW EXECUTE FUNCTION "source_ingest_schedule_wake_mapped_source"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ical_feed_calendars_source_ingest_schedule_published" ON "ical_feed_calendars";
--> statement-breakpoint
CREATE TRIGGER "ical_feed_calendars_source_ingest_schedule_published"
AFTER INSERT ON "ical_feed_calendars"
FOR EACH ROW EXECUTE FUNCTION "source_ingest_schedule_wake_published_calendar"();
--> statement-breakpoint
INSERT INTO "source_ingest_schedule" ("calendarId", "dueAt", "parkedReason", "failureCount", "lastFailureAt")
SELECT
  "id",
  CASE
    WHEN "disabled" OR NOT ('pull' = ANY("capabilities")) THEN NULL
    WHEN "ingestWindowRecordedAt" IS NULL THEN now()
    ELSE now() + random() * interval '10 minutes'
  END,
  CASE WHEN "disabled" OR NOT ('pull' = ANY("capabilities")) THEN 'ineligible' END,
  "ingestFailureCount",
  "ingestLastFailureAt"
FROM "calendars"
ON CONFLICT ("calendarId") DO NOTHING;
