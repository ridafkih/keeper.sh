CREATE TABLE IF NOT EXISTS "ical_feed_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedId" uuid NOT NULL,
	"calendarId" uuid NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ical_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"name" text DEFAULT 'My Calendar' NOT NULL,
	"token" text NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"legacyAlias" boolean DEFAULT false NOT NULL,
	"includeEventName" boolean DEFAULT false NOT NULL,
	"includeEventDescription" boolean DEFAULT false NOT NULL,
	"includeEventLocation" boolean DEFAULT false NOT NULL,
	"excludeAllDayEvents" boolean DEFAULT false NOT NULL,
	"excludeFocusTime" boolean DEFAULT false NOT NULL,
	"excludeOutOfOffice" boolean DEFAULT false NOT NULL,
	"customEventName" text DEFAULT 'Busy' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ical_feed_calendars_feedId_ical_feeds_id_fk'
      AND conrelid = 'ical_feed_calendars'::regclass
  ) THEN
    ALTER TABLE "ical_feed_calendars" ADD CONSTRAINT "ical_feed_calendars_feedId_ical_feeds_id_fk" FOREIGN KEY ("feedId") REFERENCES "public"."ical_feeds"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ical_feed_calendars_calendarId_calendars_id_fk'
      AND conrelid = 'ical_feed_calendars'::regclass
  ) THEN
    ALTER TABLE "ical_feed_calendars" ADD CONSTRAINT "ical_feed_calendars_calendarId_calendars_id_fk" FOREIGN KEY ("calendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ical_feeds_userId_user_id_fk'
      AND conrelid = 'ical_feeds'::regclass
  ) THEN
    ALTER TABLE "ical_feeds" ADD CONSTRAINT "ical_feeds_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ical_feed_calendar_idx" ON "ical_feed_calendars" USING btree ("feedId","calendarId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ical_feed_calendars_feed_idx" ON "ical_feed_calendars" USING btree ("feedId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ical_feed_calendars_calendar_idx" ON "ical_feed_calendars" USING btree ("calendarId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ical_feeds_user_idx" ON "ical_feeds" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ical_feeds_token_idx" ON "ical_feeds" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ical_feeds_default_idx" ON "ical_feeds" USING btree ("userId") WHERE "ical_feeds"."isDefault" = true;--> statement-breakpoint
INSERT INTO "ical_feeds" (
	"userId",
	"name",
	"token",
	"isDefault",
	"legacyAlias",
	"includeEventName",
	"includeEventDescription",
	"includeEventLocation",
	"excludeAllDayEvents",
	"customEventName"
)
SELECT
	u."id",
	'My Calendar',
	'feed_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
	true,
	true,
	COALESCE(s."includeEventName", false),
	COALESCE(s."includeEventDescription", false),
	COALESCE(s."includeEventLocation", false),
	COALESCE(s."excludeAllDayEvents", false),
	COALESCE(s."customEventName", 'Busy')
FROM "user" u
LEFT JOIN "ical_feed_settings" s ON s."userId" = u."id"
WHERE u."createdAt" <= transaction_timestamp()
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "ical_feed_calendars" ("feedId", "calendarId")
SELECT f."id", c."id"
FROM "ical_feeds" f
INNER JOIN "calendars" c ON c."userId" = f."userId" AND c."includeInIcalFeed" = true
WHERE f."isDefault"
ON CONFLICT DO NOTHING;--> statement-breakpoint
DO $$
DECLARE
	missing_feeds bigint;
	missing_calendars bigint;
BEGIN
	SELECT count(*) INTO missing_feeds
	FROM "user" u
	WHERE u."createdAt" < transaction_timestamp() - interval '1 minute'
		AND NOT EXISTS (SELECT 1 FROM "ical_feeds" f WHERE f."userId" = u."id");

	IF missing_feeds > 0 THEN
		RAISE EXCEPTION 'ical_feeds backfill missed % users', missing_feeds;
	END IF;

	SELECT count(*) INTO missing_calendars
	FROM "calendars" c
	INNER JOIN "ical_feeds" f ON f."userId" = c."userId" AND f."isDefault"
	WHERE c."includeInIcalFeed"
		AND c."createdAt" < transaction_timestamp() - interval '1 minute'
		AND NOT EXISTS (
			SELECT 1 FROM "ical_feed_calendars" fc
			WHERE fc."feedId" = f."id" AND fc."calendarId" = c."id"
		);

	IF missing_calendars > 0 THEN
		RAISE EXCEPTION 'ical_feed_calendars backfill missed % selections', missing_calendars;
	END IF;
END $$;