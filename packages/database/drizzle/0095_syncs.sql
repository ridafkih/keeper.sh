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
DROP TABLE IF EXISTS "sync_calendar_settings";--> statement-breakpoint
CREATE TEMP TABLE "sync_calendar_settings" AS
SELECT
	c."id",
	c."userId",
	c."name",
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
	c."excludeOutOfOffice" AS "skipOutOfOffice"
FROM "calendars" c
WHERE EXISTS (
	SELECT 1 FROM "source_destination_mappings" m
	WHERE m."sourceCalendarId" = c."id" AND m."syncId" IS NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX ON "sync_calendar_settings" ("id");--> statement-breakpoint
DROP TABLE IF EXISTS "sync_mesh_edges";--> statement-breakpoint
CREATE TEMP TABLE "sync_mesh_edges" AS
SELECT m."sourceCalendarId" AS "from", m."destinationCalendarId" AS "to"
FROM "source_destination_mappings" m
INNER JOIN "source_destination_mappings" back
	ON back."sourceCalendarId" = m."destinationCalendarId"
	AND back."destinationCalendarId" = m."sourceCalendarId"
	AND back."syncId" IS NULL
INNER JOIN "sync_calendar_settings" a ON a."id" = m."sourceCalendarId"
INNER JOIN "sync_calendar_settings" b ON b."id" = m."destinationCalendarId"
WHERE m."syncId" IS NULL
	AND (a."shareAs", a."busyTitle", a."markPrivate", a."skipAllDay", a."skipFocusTime", a."skipOutOfOffice")
		IS NOT DISTINCT FROM (b."shareAs", b."busyTitle", b."markPrivate", b."skipAllDay", b."skipFocusTime", b."skipOutOfOffice");--> statement-breakpoint
CREATE INDEX ON "sync_mesh_edges" ("from", "to");--> statement-breakpoint
DROP TABLE IF EXISTS "sync_mesh_degrees";--> statement-breakpoint
CREATE TEMP TABLE "sync_mesh_degrees" AS
SELECT "from" AS "node", count(*) AS "degree" FROM "sync_mesh_edges" GROUP BY "from";--> statement-breakpoint
CREATE UNIQUE INDEX ON "sync_mesh_degrees" ("node");--> statement-breakpoint
ANALYZE "sync_mesh_edges";--> statement-breakpoint
ANALYZE "sync_mesh_degrees";--> statement-breakpoint
DO $$
DECLARE
	"seeds" uuid[];
	"seed" uuid;
	"candidate" uuid;
	"clique" uuid[];
	"meshId" uuid;
	"meshName" text;
BEGIN
	"seeds" := ARRAY(
		SELECT d."node" FROM "sync_mesh_degrees" d ORDER BY d."degree" DESC, d."node"::text
	);
	FOREACH "seed" IN ARRAY "seeds" LOOP
		"clique" := ARRAY["seed"];
		FOR "candidate" IN
			SELECT e."to"
			FROM "sync_mesh_edges" e
			INNER JOIN "sync_mesh_degrees" d ON d."node" = e."to"
			WHERE e."from" = "seed"
			ORDER BY d."degree" DESC, e."to"::text
		LOOP
			EXIT WHEN cardinality("clique") >= 8;
			IF (SELECT count(*) FROM "sync_mesh_edges" e WHERE e."from" = "candidate" AND e."to" = ANY("clique")) = cardinality("clique") THEN
				"clique" := "clique" || "candidate";
			END IF;
		END LOOP;
		CONTINUE WHEN cardinality("clique") < 2;

		"meshId" := gen_random_uuid();
		SELECT string_agg(s."name", ' ↔ ' ORDER BY s."name", s."id") INTO "meshName"
		FROM "sync_calendar_settings" s WHERE s."id" = ANY("clique");
		IF length("meshName") > 80 THEN
			"meshName" := left("meshName", 79) || '…';
		END IF;

		INSERT INTO "syncs" ("id", "userId", "name", "mode", "shareAs", "busyTitle", "markPrivate", "skipAllDay", "skipFocusTime", "skipOutOfOffice")
		SELECT "meshId", s."userId", "meshName", 'both_ways', s."shareAs", s."busyTitle", s."markPrivate", s."skipAllDay", s."skipFocusTime", s."skipOutOfOffice"
		FROM "sync_calendar_settings" s WHERE s."id" = "seed";

		INSERT INTO "sync_calendars" ("syncId", "calendarId", "role", "position")
		SELECT "meshId", s."id", 'member', row_number() OVER (ORDER BY s."name", s."id") - 1
		FROM "sync_calendar_settings" s WHERE s."id" = ANY("clique");

		UPDATE "source_destination_mappings" m
		SET "syncId" = "meshId"
		WHERE m."syncId" IS NULL
			AND m."sourceCalendarId" = ANY("clique")
			AND m."destinationCalendarId" = ANY("clique");

		DELETE FROM "sync_mesh_edges" e WHERE e."from" = ANY("clique") AND e."to" = ANY("clique");
	END LOOP;
END $$;--> statement-breakpoint
DROP TABLE "sync_mesh_edges";--> statement-breakpoint
DROP TABLE "sync_mesh_degrees";--> statement-breakpoint
DROP TABLE IF EXISTS "sync_backfill";--> statement-breakpoint
CREATE TEMP TABLE "sync_backfill" AS
WITH "per_source" AS (
	SELECT
		s."userId",
		s."id" AS "sourceCalendarId",
		s."name" AS "sourceName",
		s."shareAs",
		s."busyTitle",
		s."markPrivate",
		s."skipAllDay",
		s."skipFocusTime",
		s."skipOutOfOffice",
		array_agg(m."destinationCalendarId" ORDER BY d."name", m."destinationCalendarId") AS "destinations",
		string_agg(d."name", ', ' ORDER BY d."name") AS "destinationNames"
	FROM "source_destination_mappings" m
	INNER JOIN "sync_calendar_settings" s ON s."id" = m."sourceCalendarId"
	INNER JOIN "calendars" d ON d."id" = m."destinationCalendarId"
	WHERE m."syncId" IS NULL
	GROUP BY s."id", s."userId", s."name", s."shareAs", s."busyTitle", s."markPrivate", s."skipAllDay", s."skipFocusTime", s."skipOutOfOffice"
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
SET "syncId" = pair."syncId"
FROM (
	SELECT b."syncId", source."calendarId" AS "sourceCalendarId", destination."calendarId" AS "destinationCalendarId"
	FROM "sync_backfill" b, unnest(b."sources") AS source("calendarId"), unnest(b."destinations") AS destination("calendarId")
) pair
WHERE m."syncId" IS NULL
	AND m."sourceCalendarId" = pair."sourceCalendarId"
	AND m."destinationCalendarId" = pair."destinationCalendarId";--> statement-breakpoint
DROP TABLE "sync_backfill";--> statement-breakpoint
DROP TABLE "sync_calendar_settings";--> statement-breakpoint
-- Writers from before syncs insert pairs without a sync; this files each one under the sync that already covers it.
CREATE OR REPLACE FUNCTION keeper_fill_source_destination_mapping_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	"owner" uuid;
BEGIN
	SELECT src."syncId" INTO "owner"
	FROM "sync_calendars" src
	INNER JOIN "sync_calendars" dst
		ON dst."syncId" = src."syncId"
		AND dst."calendarId" = NEW."destinationCalendarId"
	WHERE src."calendarId" = NEW."sourceCalendarId"
		AND (
			(src."role" = 'source' AND dst."role" = 'destination')
			OR (src."role" = 'member' AND dst."role" = 'member')
		)
	ORDER BY src."syncId"
	LIMIT 1;

	IF "owner" IS NULL THEN
		"owner" := gen_random_uuid();
		INSERT INTO "syncs" ("id", "userId", "name", "mode", "shareAs", "busyTitle", "markPrivate", "skipAllDay", "skipFocusTime", "skipOutOfOffice")
		SELECT
			"owner",
			c."userId",
			CASE WHEN length(c."name" || ' → ' || d."name") > 80 THEN left(c."name" || ' → ' || d."name", 79) || '…' ELSE c."name" || ' → ' || d."name" END,
			'one_way',
			CASE
				WHEN c."excludeEventName" THEN 'busy_only'
				WHEN c."excludeEventDescription" OR c."excludeEventLocation" THEN 'title_only'
				ELSE 'full'
			END,
			CASE
				WHEN c."excludeEventName" AND NULLIF(btrim(c."customEventName"), '') IS NOT NULL AND c."customEventName" <> '{{calendar_name}}'
				THEN c."customEventName"
			END,
			c."markEventsAsPrivate",
			c."excludeAllDayEvents",
			c."excludeFocusTime",
			c."excludeOutOfOffice"
		FROM "calendars" c, "calendars" d
		WHERE c."id" = NEW."sourceCalendarId" AND d."id" = NEW."destinationCalendarId";
		INSERT INTO "sync_calendars" ("syncId", "calendarId", "role", "position")
		VALUES ("owner", NEW."sourceCalendarId", 'source', 0), ("owner", NEW."destinationCalendarId", 'destination', 0);
	END IF;

	NEW."syncId" := "owner";
	RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "source_destination_mappings_sync_fill" ON "source_destination_mappings";--> statement-breakpoint
CREATE TRIGGER "source_destination_mappings_sync_fill"
BEFORE INSERT ON "source_destination_mappings"
FOR EACH ROW
WHEN (NEW."syncId" IS NULL)
EXECUTE FUNCTION keeper_fill_source_destination_mapping_sync();--> statement-breakpoint
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
