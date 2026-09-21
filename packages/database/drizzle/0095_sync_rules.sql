CREATE TABLE IF NOT EXISTS "sync_rules" (
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_rule_assignments" (
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"destinationCalendarId" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" integer NOT NULL,
	"ruleId" uuid NOT NULL,
	"sourceCalendarId" uuid NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sync_rules_userId_user_id_fk'
      AND conrelid = 'sync_rules'::regclass
  ) THEN
    ALTER TABLE "sync_rules" ADD CONSTRAINT "sync_rules_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sync_rule_assignments_sourceCalendarId_calendars_id_fk'
      AND conrelid = 'sync_rule_assignments'::regclass
  ) THEN
    ALTER TABLE "sync_rule_assignments" ADD CONSTRAINT "sync_rule_assignments_sourceCalendarId_calendars_id_fk" FOREIGN KEY ("sourceCalendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sync_rule_assignments_destinationCalendarId_calendars_id_fk'
      AND conrelid = 'sync_rule_assignments'::regclass
  ) THEN
    ALTER TABLE "sync_rule_assignments" ADD CONSTRAINT "sync_rule_assignments_destinationCalendarId_calendars_id_fk" FOREIGN KEY ("destinationCalendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sync_rule_assignments_ruleId_sync_rules_id_fk'
      AND conrelid = 'sync_rule_assignments'::regclass
  ) THEN
    ALTER TABLE "sync_rule_assignments" ADD CONSTRAINT "sync_rule_assignments_ruleId_sync_rules_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."sync_rules"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_rules_user_idx" ON "sync_rules" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sync_rules_user_default_idx" ON "sync_rules" USING btree ("userId") WHERE "sync_rules"."isDefault" = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sync_rule_assignments_pair_rule_idx" ON "sync_rule_assignments" USING btree ("sourceCalendarId","destinationCalendarId","ruleId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_rule_assignments_pair_position_idx" ON "sync_rule_assignments" USING btree ("sourceCalendarId","destinationCalendarId","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_rule_assignments_rule_idx" ON "sync_rule_assignments" USING btree ("ruleId");--> statement-breakpoint
INSERT INTO "sync_rules" ("userId", "name", "conditions", "actions", "isDefault")
SELECT
	t."userId",
	CASE
		WHEN t."actions" = '[{"kind":"rename","template":"{{calendar_name}}"},{"kind":"drop_description"},{"kind":"drop_location"}]'::jsonb THEN 'Busy only'
		WHEN t."actions" = '[]'::jsonb THEN 'Copy as-is'
		ELSE t."calendarName" || ' settings'
	END,
	'[]'::jsonb,
	t."actions",
	row_number() OVER (
		PARTITION BY t."userId"
		ORDER BY (t."actions" = '[{"kind":"rename","template":"{{calendar_name}}"},{"kind":"drop_description"},{"kind":"drop_location"}]'::jsonb) DESC, t."calendarName"
	) = 1
FROM (
	SELECT
		c."userId",
		(CASE WHEN c."excludeEventName" THEN jsonb_build_array(jsonb_build_object('kind', 'rename', 'template', COALESCE(NULLIF(c."customEventName", ''), '{{calendar_name}}'))) ELSE '[]'::jsonb END)
			|| (CASE WHEN c."excludeEventDescription" THEN '[{"kind":"drop_description"}]'::jsonb ELSE '[]'::jsonb END)
			|| (CASE WHEN c."excludeEventLocation" THEN '[{"kind":"drop_location"}]'::jsonb ELSE '[]'::jsonb END)
			|| (CASE WHEN c."markEventsAsPrivate" THEN '[{"kind":"mark_private"}]'::jsonb ELSE '[]'::jsonb END) AS "actions",
		min(c."name") AS "calendarName"
	FROM "calendars" c
	WHERE EXISTS (SELECT 1 FROM "source_destination_mappings" m WHERE m."sourceCalendarId" = c."id")
	GROUP BY c."userId", "actions"
) t
WHERE NOT EXISTS (SELECT 1 FROM "sync_rules" r WHERE r."userId" = t."userId");--> statement-breakpoint
INSERT INTO "sync_rules" ("userId", "name", "conditions", "actions")
SELECT DISTINCT c."userId", 'Skip all-day events', '[{"kind":"all_day"}]'::jsonb, '[{"kind":"skip"}]'::jsonb
FROM "calendars" c
WHERE c."excludeAllDayEvents"
	AND EXISTS (SELECT 1 FROM "source_destination_mappings" m WHERE m."sourceCalendarId" = c."id")
	AND NOT EXISTS (
		SELECT 1 FROM "sync_rules" r
		WHERE r."userId" = c."userId" AND r."conditions" = '[{"kind":"all_day"}]'::jsonb AND r."actions" = '[{"kind":"skip"}]'::jsonb
	);--> statement-breakpoint
INSERT INTO "sync_rules" ("userId", "name", "conditions", "actions")
SELECT DISTINCT c."userId", 'Skip focus time', '[{"kind":"focus_time"}]'::jsonb, '[{"kind":"skip"}]'::jsonb
FROM "calendars" c
WHERE c."excludeFocusTime"
	AND EXISTS (SELECT 1 FROM "source_destination_mappings" m WHERE m."sourceCalendarId" = c."id")
	AND NOT EXISTS (
		SELECT 1 FROM "sync_rules" r
		WHERE r."userId" = c."userId" AND r."conditions" = '[{"kind":"focus_time"}]'::jsonb AND r."actions" = '[{"kind":"skip"}]'::jsonb
	);--> statement-breakpoint
INSERT INTO "sync_rules" ("userId", "name", "conditions", "actions")
SELECT DISTINCT c."userId", 'Skip out of office', '[{"kind":"out_of_office"}]'::jsonb, '[{"kind":"skip"}]'::jsonb
FROM "calendars" c
WHERE c."excludeOutOfOffice"
	AND EXISTS (SELECT 1 FROM "source_destination_mappings" m WHERE m."sourceCalendarId" = c."id")
	AND NOT EXISTS (
		SELECT 1 FROM "sync_rules" r
		WHERE r."userId" = c."userId" AND r."conditions" = '[{"kind":"out_of_office"}]'::jsonb AND r."actions" = '[{"kind":"skip"}]'::jsonb
	);--> statement-breakpoint
INSERT INTO "sync_rule_assignments" ("sourceCalendarId", "destinationCalendarId", "ruleId", "position")
SELECT
	x."sourceCalendarId",
	x."destinationCalendarId",
	x."ruleId",
	row_number() OVER (PARTITION BY x."sourceCalendarId", x."destinationCalendarId" ORDER BY x."rank") - 1
FROM (
	SELECT
		m."sourceCalendarId",
		m."destinationCalendarId",
		r."id" AS "ruleId",
		CASE r."conditions"
			WHEN '[{"kind":"all_day"}]'::jsonb THEN 0
			WHEN '[{"kind":"focus_time"}]'::jsonb THEN 1
			WHEN '[{"kind":"out_of_office"}]'::jsonb THEN 2
			ELSE 3
		END AS "rank"
	FROM "source_destination_mappings" m
	INNER JOIN "calendars" c ON c."id" = m."sourceCalendarId"
	INNER JOIN "sync_rules" r ON r."userId" = c."userId" AND (
		(
			r."conditions" = '[]'::jsonb
			AND r."actions" = (CASE WHEN c."excludeEventName" THEN jsonb_build_array(jsonb_build_object('kind', 'rename', 'template', COALESCE(NULLIF(c."customEventName", ''), '{{calendar_name}}'))) ELSE '[]'::jsonb END)
				|| (CASE WHEN c."excludeEventDescription" THEN '[{"kind":"drop_description"}]'::jsonb ELSE '[]'::jsonb END)
				|| (CASE WHEN c."excludeEventLocation" THEN '[{"kind":"drop_location"}]'::jsonb ELSE '[]'::jsonb END)
				|| (CASE WHEN c."markEventsAsPrivate" THEN '[{"kind":"mark_private"}]'::jsonb ELSE '[]'::jsonb END)
		)
		OR (c."excludeAllDayEvents" AND r."conditions" = '[{"kind":"all_day"}]'::jsonb AND r."actions" = '[{"kind":"skip"}]'::jsonb)
		OR (c."excludeFocusTime" AND r."conditions" = '[{"kind":"focus_time"}]'::jsonb AND r."actions" = '[{"kind":"skip"}]'::jsonb)
		OR (c."excludeOutOfOffice" AND r."conditions" = '[{"kind":"out_of_office"}]'::jsonb AND r."actions" = '[{"kind":"skip"}]'::jsonb)
	)
	WHERE NOT EXISTS (
		SELECT 1 FROM "sync_rule_assignments" a
		WHERE a."sourceCalendarId" = m."sourceCalendarId" AND a."destinationCalendarId" = m."destinationCalendarId"
	)
) x
ON CONFLICT DO NOTHING;
