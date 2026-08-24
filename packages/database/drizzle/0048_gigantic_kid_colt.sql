CREATE TABLE "ical_feed_settings" (
	"userId" text PRIMARY KEY NOT NULL,
	"includeEventName" boolean DEFAULT false NOT NULL,
	"includeEventDescription" boolean DEFAULT false NOT NULL,
	"includeEventLocation" boolean DEFAULT false NOT NULL,
	"excludeAllDayEvents" boolean DEFAULT false NOT NULL,
	"customEventName" text DEFAULT 'Busy' NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "ical_feed_settings" (
	"userId",
	"includeEventName",
	"includeEventDescription",
	"includeEventLocation",
	"excludeAllDayEvents",
	"customEventName",
	"updatedAt"
)
SELECT
	calendar_users."userId",
	false,
	false,
	false,
	false,
	'{{calendar_name}}',
	calendar_users."updatedAt"
FROM (
	SELECT
		c."userId",
		MAX(c."updatedAt") AS "updatedAt"
	FROM "calendars" c
	WHERE c."includeInIcalFeed" = true
	GROUP BY c."userId"
) AS calendar_users;
--> statement-breakpoint
ALTER TABLE "ical_feed_settings" ADD CONSTRAINT "ical_feed_settings_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
