-- Parent tables first, the order FK cascades take them in, so a concurrent delete can't deadlock with this.
DO $$ BEGIN LOCK TABLE "user", "calendars" IN SHARE ROW EXCLUSIVE MODE; END $$;--> statement-breakpoint
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
	"skipAvailabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skipFocusTime" boolean DEFAULT false NOT NULL,
	"skipOutOfOffice" boolean DEFAULT false NOT NULL,
	"skipTitleKeywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "syncs_mode_check" CHECK ("syncs"."mode" IN ('one_way', 'both_ways')),
	CONSTRAINT "syncs_share_as_check" CHECK ("syncs"."shareAs" IN ('busy_only', 'title_only', 'full'))
);
--> statement-breakpoint
ALTER TABLE "syncs" ADD COLUMN IF NOT EXISTS "skipAvailabilities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
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
CREATE TABLE IF NOT EXISTS "sync_activity_days" (
	"added" integer DEFAULT 0 NOT NULL,
	"day" date NOT NULL,
	"removed" integer DEFAULT 0 NOT NULL,
	"syncId" uuid NOT NULL,
	CONSTRAINT "sync_activity_days_syncId_day_pk" PRIMARY KEY("syncId","day")
);
--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "copiedCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "failedCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "lastErrorAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "skippedBy" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
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
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sync_activity_days_syncId_syncs_id_fk'
      AND conrelid = 'sync_activity_days'::regclass
  ) THEN
    ALTER TABLE "sync_activity_days" ADD CONSTRAINT "sync_activity_days_syncId_syncs_id_fk" FOREIGN KEY ("syncId") REFERENCES "public"."syncs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "syncs_user_idx" ON "syncs" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_calendars_calendar_idx" ON "sync_calendars" USING btree ("calendarId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_activity_sync_created_idx" ON "sync_activity" USING btree ("syncId","createdAt" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
-- A calendar never copied into itself usefully, and a sync can't hold one.
DELETE FROM "source_destination_mappings" WHERE "sourceCalendarId" = "destinationCalendarId";--> statement-breakpoint
-- Main applied the title, description and location flags separately. Share As covers three of those
-- combinations; any other becomes Share As Everything plus one rule for every event that drops the same fields.
DROP FUNCTION IF EXISTS keeper_legacy_sync_settings(uuid);--> statement-breakpoint
CREATE OR REPLACE FUNCTION keeper_legacy_sync_settings("legacyCalendarId" uuid)
RETURNS TABLE (
	"shareAs" text,
	"busyTitle" text,
	"earlierActions" jsonb,
	"markPrivate" boolean,
	"skipAllDay" boolean,
	"skipFocusTime" boolean,
	"skipOutOfOffice" boolean,
	"skipAvailabilities" jsonb,
	"skipTitleKeywords" jsonb
)
LANGUAGE sql
STABLE
AS $$
	WITH "flags" AS (
		SELECT
			c."excludeEventName" AS "name",
			c."excludeEventDescription" AS "description",
			c."excludeEventLocation" AS "location",
			left(COALESCE(NULLIF(btrim(c."customEventName"), ''), '{{calendar_name}}'), 200) AS "template",
			c."markEventsAsPrivate",
			c."excludeAllDayEvents",
			c."excludeFocusTime",
			c."excludeOutOfOffice",
			c."excludeAvailabilities",
			c."excludeTitleKeywords"
		FROM "calendars" c
		WHERE c."id" = "legacyCalendarId"
	), "levels" AS (
		SELECT
			f.*,
			CASE
				WHEN f."name" AND f."description" AND f."location" AND position('{{event_name}}' IN f."template") = 0 THEN 'busy_only'
				WHEN NOT f."name" AND f."description" AND f."location" THEN 'title_only'
				WHEN NOT f."name" AND NOT f."description" AND NOT f."location" THEN 'full'
			END AS "level"
		FROM "flags" f
	)
	SELECT
		COALESCE(l."level", 'full'),
		CASE WHEN l."level" = 'busy_only' AND l."template" <> '{{calendar_name}}' THEN l."template" END,
		CASE WHEN l."level" IS NULL THEN (
			SELECT jsonb_agg(v."action" ORDER BY v."position")
			FROM (VALUES
				(1, CASE WHEN l."name" THEN jsonb_build_object('kind', 'rename', 'template', l."template") END),
				(2, CASE WHEN l."description" THEN '{"kind":"drop_description"}'::jsonb END),
				(3, CASE WHEN l."location" THEN '{"kind":"drop_location"}'::jsonb END)
			) AS v("position", "action")
			WHERE v."action" IS NOT NULL
		) END,
		l."markEventsAsPrivate",
		l."excludeAllDayEvents",
		l."excludeFocusTime",
		l."excludeOutOfOffice",
		to_jsonb(ARRAY(
			SELECT status FROM unnest(ARRAY['busy', 'free', 'tentative']) status
			WHERE status = ANY(l."excludeAvailabilities")
		)),
		to_jsonb(l."excludeTitleKeywords")
	FROM "levels" l
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION keeper_legacy_sync_rules("earlierActions" jsonb)
RETURNS jsonb
LANGUAGE sql
VOLATILE
AS $$
	SELECT CASE
		WHEN "earlierActions" IS NULL THEN '[]'::jsonb
		ELSE jsonb_build_array(jsonb_build_object(
			'actions', "earlierActions",
			'conditions', '[{"kind":"all_day"},{"kind":"timed"}]'::jsonb,
			'id', gen_random_uuid()::text,
			'match', 'any',
			'name', 'Kept from earlier settings'
		))
	END
$$;--> statement-breakpoint
DROP TABLE IF EXISTS "sync_calendar_settings";--> statement-breakpoint
CREATE TEMP TABLE "sync_calendar_settings" AS
SELECT
	c."id",
	c."userId",
	CASE
		WHEN EXISTS (
			SELECT 1 FROM "calendars" twin
			WHERE twin."userId" = c."userId" AND twin."id" <> c."id" AND twin."name" = c."name"
		) THEN c."name" || ' (' || COALESCE(NULLIF(a."email", ''), NULLIF(a."displayName", ''), a."provider") || ')'
		ELSE c."name"
	END AS "name",
	legacy."shareAs",
	legacy."busyTitle",
	legacy."earlierActions",
	legacy."markPrivate",
	legacy."skipAllDay",
	legacy."skipFocusTime",
	legacy."skipOutOfOffice",
	legacy."skipAvailabilities",
	legacy."skipTitleKeywords"
FROM "calendars" c
INNER JOIN "calendar_accounts" a ON a."id" = c."accountId"
CROSS JOIN LATERAL keeper_legacy_sync_settings(c."id") legacy
WHERE EXISTS (
	SELECT 1 FROM "source_destination_mappings" m
	WHERE (m."sourceCalendarId" = c."id" OR m."destinationCalendarId" = c."id") AND m."syncId" IS NULL
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
	AND (a."shareAs", a."busyTitle", a."earlierActions", a."markPrivate", a."skipAllDay", a."skipFocusTime", a."skipOutOfOffice", a."skipAvailabilities", a."skipTitleKeywords")
		IS NOT DISTINCT FROM (b."shareAs", b."busyTitle", b."earlierActions", b."markPrivate", b."skipAllDay", b."skipFocusTime", b."skipOutOfOffice", b."skipAvailabilities", b."skipTitleKeywords");--> statement-breakpoint
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

		INSERT INTO "syncs" ("id", "userId", "name", "mode", "shareAs", "busyTitle", "rules", "markPrivate", "skipAllDay", "skipFocusTime", "skipOutOfOffice", "skipAvailabilities", "skipTitleKeywords")
		SELECT "meshId", s."userId", "meshName", 'both_ways', s."shareAs", s."busyTitle", keeper_legacy_sync_rules(s."earlierActions"), s."markPrivate", s."skipAllDay", s."skipFocusTime", s."skipOutOfOffice", s."skipAvailabilities", s."skipTitleKeywords"
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
		s."earlierActions",
		s."markPrivate",
		s."skipAllDay",
		s."skipFocusTime",
		s."skipOutOfOffice",
		s."skipAvailabilities",
		s."skipTitleKeywords",
		array_agg(m."destinationCalendarId" ORDER BY d."name", m."destinationCalendarId") AS "destinations",
		string_agg(d."name", ', ' ORDER BY d."name", m."destinationCalendarId") AS "destinationNames"
	FROM "source_destination_mappings" m
	INNER JOIN "sync_calendar_settings" s ON s."id" = m."sourceCalendarId"
	INNER JOIN "sync_calendar_settings" d ON d."id" = m."destinationCalendarId"
	WHERE m."syncId" IS NULL
	GROUP BY s."id", s."userId", s."name", s."shareAs", s."busyTitle", s."earlierActions", s."markPrivate", s."skipAllDay", s."skipFocusTime", s."skipOutOfOffice", s."skipAvailabilities", s."skipTitleKeywords"
)
SELECT
	gen_random_uuid() AS "syncId",
	"userId",
	"shareAs",
	"busyTitle",
	"earlierActions",
	"markPrivate",
	"skipAllDay",
	"skipFocusTime",
	"skipOutOfOffice",
	"skipAvailabilities",
	"skipTitleKeywords",
	"destinations",
	array_agg("sourceCalendarId" ORDER BY "sourceName", "sourceCalendarId") AS "sources",
	string_agg("sourceName", ', ' ORDER BY "sourceName", "sourceCalendarId") || ' → ' || "destinationNames" AS "name"
FROM "per_source"
GROUP BY "userId", "shareAs", "busyTitle", "earlierActions", "markPrivate", "skipAllDay", "skipFocusTime", "skipOutOfOffice", "skipAvailabilities", "skipTitleKeywords", "destinations", "destinationNames";--> statement-breakpoint
INSERT INTO "syncs" ("id", "userId", "name", "mode", "shareAs", "busyTitle", "rules", "markPrivate", "skipAllDay", "skipFocusTime", "skipOutOfOffice", "skipAvailabilities", "skipTitleKeywords")
SELECT "syncId", "userId", CASE WHEN length("name") > 80 THEN left("name", 79) || '…' ELSE "name" END, 'one_way', "shareAs", "busyTitle", keeper_legacy_sync_rules("earlierActions"), "markPrivate", "skipAllDay", "skipFocusTime", "skipOutOfOffice", "skipAvailabilities", "skipTitleKeywords"
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
	IF NEW."sourceCalendarId" = NEW."destinationCalendarId" THEN
		RETURN NULL;
	END IF;

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
		INSERT INTO "syncs" ("id", "userId", "name", "mode", "shareAs", "busyTitle", "rules", "markPrivate", "skipAllDay", "skipFocusTime", "skipOutOfOffice", "skipAvailabilities", "skipTitleKeywords")
		SELECT
			"owner",
			c."userId",
			CASE WHEN length(c."name" || ' → ' || d."name") > 80 THEN left(c."name" || ' → ' || d."name", 79) || '…' ELSE c."name" || ' → ' || d."name" END,
			'one_way',
			legacy."shareAs",
			legacy."busyTitle",
			keeper_legacy_sync_rules(legacy."earlierActions"),
			legacy."markPrivate",
			legacy."skipAllDay",
			legacy."skipFocusTime",
			legacy."skipOutOfOffice",
			legacy."skipAvailabilities",
			legacy."skipTitleKeywords"
		FROM "calendars" c
		CROSS JOIN "calendars" d
		CROSS JOIN LATERAL keeper_legacy_sync_settings(c."id") legacy
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
-- And a pair main's code deletes takes its calendar out of the sync once nothing else uses it there, so a
-- later edit doesn't bring the pair back. It runs at commit, after main re-inserts the pairs it keeps, and
-- leaves alone a pair that went because its other calendar was deleted.
CREATE OR REPLACE FUNCTION keeper_prune_source_destination_mapping_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	DELETE FROM "sync_calendars" sc
	WHERE sc."syncId" = OLD."syncId"
		AND (
			(sc."role" IN ('source', 'member') AND sc."calendarId" = OLD."sourceCalendarId"
				AND EXISTS (SELECT 1 FROM "calendars" c WHERE c."id" = OLD."destinationCalendarId"))
			OR (sc."role" IN ('destination', 'member') AND sc."calendarId" = OLD."destinationCalendarId"
				AND EXISTS (SELECT 1 FROM "calendars" c WHERE c."id" = OLD."sourceCalendarId"))
		)
		AND NOT EXISTS (
			SELECT 1 FROM "source_destination_mappings" m
			WHERE m."syncId" = OLD."syncId"
				AND (
					(sc."role" = 'source' AND m."sourceCalendarId" = sc."calendarId")
					OR (sc."role" = 'destination' AND m."destinationCalendarId" = sc."calendarId")
					OR (sc."role" = 'member' AND sc."calendarId" IN (m."sourceCalendarId", m."destinationCalendarId"))
				)
		);
	RETURN NULL;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "source_destination_mappings_sync_prune" ON "source_destination_mappings";--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "source_destination_mappings_sync_prune"
AFTER DELETE ON "source_destination_mappings"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION keeper_prune_source_destination_mapping_sync();--> statement-breakpoint
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
