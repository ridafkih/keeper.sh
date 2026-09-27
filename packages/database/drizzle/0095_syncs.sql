DROP TABLE IF EXISTS "sync_rule_assignments";--> statement-breakpoint
DROP TABLE IF EXISTS "sync_rules";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "syncs" (
	"busyTitle" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"markPrivate" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'one_way' NOT NULL,
	"name" text NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shareAs" text DEFAULT 'busy_only' NOT NULL,
	"skipAllDay" boolean DEFAULT false NOT NULL,
	"skipFocusTime" boolean DEFAULT false NOT NULL,
	"skipOutOfOffice" boolean DEFAULT false NOT NULL,
	"skipTitleKeywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "syncs_mode_check" CHECK ("syncs"."mode" IN ('one_way', 'both_ways')),
	CONSTRAINT "syncs_share_as_check" CHECK ("syncs"."shareAs" IN ('busy_only', 'title_only', 'full'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_calendars" (
	"calendarId" uuid NOT NULL,
	"position" integer NOT NULL,
	"role" text NOT NULL,
	"syncId" uuid NOT NULL,
	CONSTRAINT "sync_calendars_syncId_calendarId_pk" PRIMARY KEY("syncId","calendarId"),
	CONSTRAINT "sync_calendars_role_check" CHECK ("sync_calendars"."role" IN ('source', 'destination', 'member'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_activity" (
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"syncId" uuid NOT NULL,
	CONSTRAINT "sync_activity_kind_check" CHECK ("sync_activity"."kind" IN ('change', 'run'))
);
--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "copiedCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "lastSyncedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "skippedCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "syncId" uuid;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'syncs_userId_user_id_fk'
      AND conrelid = 'syncs'::regclass
  ) THEN
    ALTER TABLE "syncs" ADD CONSTRAINT "syncs_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sync_calendars_calendarId_calendars_id_fk'
      AND conrelid = 'sync_calendars'::regclass
  ) THEN
    ALTER TABLE "sync_calendars" ADD CONSTRAINT "sync_calendars_calendarId_calendars_id_fk" FOREIGN KEY ("calendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sync_calendars_syncId_syncs_id_fk'
      AND conrelid = 'sync_calendars'::regclass
  ) THEN
    ALTER TABLE "sync_calendars" ADD CONSTRAINT "sync_calendars_syncId_syncs_id_fk" FOREIGN KEY ("syncId") REFERENCES "public"."syncs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sync_activity_syncId_syncs_id_fk'
      AND conrelid = 'sync_activity'::regclass
  ) THEN
    ALTER TABLE "sync_activity" ADD CONSTRAINT "sync_activity_syncId_syncs_id_fk" FOREIGN KEY ("syncId") REFERENCES "public"."syncs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "syncs_user_idx" ON "syncs" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_calendars_calendar_idx" ON "sync_calendars" USING btree ("calendarId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_activity_sync_created_idx" ON "sync_activity" USING btree ("syncId","createdAt" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
DROP TABLE IF EXISTS "sync_backfill";--> statement-breakpoint
CREATE TEMP TABLE "sync_backfill" AS
WITH "per_source" AS (
	SELECT
		c."userId",
		c."id" AS "sourceCalendarId",
		c."name" AS "sourceName",
		CASE
			WHEN c."excludeEventName" THEN 'busy_only'
			WHEN c."excludeEventDescription" OR c."excludeEventLocation" THEN 'title_only'
			ELSE 'full'
		END AS "shareAs",
		CASE
			WHEN c."excludeEventName" AND NULLIF(btrim(c."customEventName"), '') IS NOT NULL AND c."customEventName" <> '{{calendar_name}}'
			THEN c."customEventName"
		END AS "busyTitle",
		c."markEventsAsPrivate" AS "markPrivate",
		c."excludeAllDayEvents" AS "skipAllDay",
		c."excludeFocusTime" AS "skipFocusTime",
		c."excludeOutOfOffice" AS "skipOutOfOffice",
		array_agg(m."destinationCalendarId" ORDER BY d."name", m."destinationCalendarId") AS "destinations",
		string_agg(d."name", ', ' ORDER BY d."name") AS "destinationNames"
	FROM "source_destination_mappings" m
	INNER JOIN "calendars" c ON c."id" = m."sourceCalendarId"
	INNER JOIN "calendars" d ON d."id" = m."destinationCalendarId"
	WHERE m."syncId" IS NULL
	GROUP BY c."id"
)
SELECT
	gen_random_uuid() AS "syncId",
	"userId",
	"shareAs",
	"busyTitle",
	"markPrivate",
	"skipAllDay",
	"skipFocusTime",
	"skipOutOfOffice",
	"destinations",
	array_agg("sourceCalendarId" ORDER BY "sourceName", "sourceCalendarId") AS "sources",
	string_agg("sourceName", ', ' ORDER BY "sourceName", "sourceCalendarId") || ' → ' || "destinationNames" AS "name"
FROM "per_source"
GROUP BY "userId", "shareAs", "busyTitle", "markPrivate", "skipAllDay", "skipFocusTime", "skipOutOfOffice", "destinations", "destinationNames";--> statement-breakpoint
INSERT INTO "syncs" ("id", "userId", "name", "mode", "shareAs", "busyTitle", "markPrivate", "skipAllDay", "skipFocusTime", "skipOutOfOffice")
SELECT "syncId", "userId", CASE WHEN length("name") > 80 THEN left("name", 79) || '…' ELSE "name" END, 'one_way', "shareAs", "busyTitle", "markPrivate", "skipAllDay", "skipFocusTime", "skipOutOfOffice"
FROM "sync_backfill";--> statement-breakpoint
INSERT INTO "sync_calendars" ("syncId", "calendarId", "role", "position")
SELECT b."syncId", source."calendarId", 'source', source."ordinal" - 1
FROM "sync_backfill" b, unnest(b."sources") WITH ORDINALITY AS source("calendarId", "ordinal")
UNION ALL
SELECT b."syncId", destination."calendarId", 'destination', destination."ordinal" - 1
FROM "sync_backfill" b, unnest(b."destinations") WITH ORDINALITY AS destination("calendarId", "ordinal");--> statement-breakpoint
UPDATE "source_destination_mappings" m
SET "syncId" = b."syncId"
FROM "sync_backfill" b
WHERE m."syncId" IS NULL
	AND m."sourceCalendarId" = ANY(b."sources")
	AND m."destinationCalendarId" = ANY(b."destinations");--> statement-breakpoint
DROP TABLE "sync_backfill";--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ALTER COLUMN "syncId" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'source_destination_mappings_syncId_syncs_id_fk'
      AND conrelid = 'source_destination_mappings'::regclass
  ) THEN
    ALTER TABLE "source_destination_mappings" ADD CONSTRAINT "source_destination_mappings_syncId_syncs_id_fk" FOREIGN KEY ("syncId") REFERENCES "public"."syncs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_destination_mappings_sync_idx" ON "source_destination_mappings" USING btree ("syncId");
