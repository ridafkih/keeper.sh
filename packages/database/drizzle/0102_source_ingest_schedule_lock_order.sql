CREATE OR REPLACE FUNCTION "source_ingest_schedule_release_account"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1
  FROM "source_ingest_schedule"
  WHERE "calendarId" IN (SELECT "id" FROM "calendars" WHERE "accountId" = NEW."id")
  ORDER BY "calendarId"
  FOR NO KEY UPDATE;

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
CREATE OR REPLACE FUNCTION "source_ingest_schedule_release_credential"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1
  FROM "source_ingest_schedule"
  WHERE "calendarId" IN (
    SELECT "calendars"."id"
    FROM "calendars"
    INNER JOIN "calendar_accounts" ON "calendar_accounts"."id" = "calendars"."accountId"
    WHERE "calendar_accounts"."oauthCredentialId" = NEW."id"
  )
  ORDER BY "calendarId"
  FOR NO KEY UPDATE;

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
CREATE OR REPLACE FUNCTION "source_ingest_schedule_release_caldav_credential"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1
  FROM "source_ingest_schedule"
  WHERE "calendarId" IN (
    SELECT "calendars"."id"
    FROM "calendars"
    INNER JOIN "calendar_accounts" ON "calendar_accounts"."id" = "calendars"."accountId"
    WHERE "calendar_accounts"."caldavCredentialId" = NEW."id"
  )
  ORDER BY "calendarId"
  FOR NO KEY UPDATE;

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
CREATE OR REPLACE FUNCTION "source_ingest_schedule_wake_user"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1
  FROM "source_ingest_schedule"
  WHERE "calendarId" IN (SELECT "id" FROM "calendars" WHERE "userId" = NEW."userId")
  ORDER BY "calendarId"
  FOR NO KEY UPDATE;

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
