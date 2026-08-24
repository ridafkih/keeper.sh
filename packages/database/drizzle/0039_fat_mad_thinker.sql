CREATE TABLE "sync_profiles" (
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
DROP INDEX "source_destination_mapping_idx";--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN "profileId" uuid;--> statement-breakpoint
WITH mapping_users AS (
	SELECT DISTINCT source_calendar."userId"
	FROM "source_destination_mappings" sdm
	JOIN "calendars" source_calendar ON source_calendar."id" = sdm."sourceCalendarId"
),
created_profiles AS (
	INSERT INTO "sync_profiles" ("id", "name", "userId")
	SELECT gen_random_uuid(), 'Default', mu."userId"
	FROM mapping_users mu
	RETURNING "id", "userId"
)
UPDATE "source_destination_mappings" sdm
SET "profileId" = cp."id"
FROM "calendars" source_calendar
JOIN created_profiles cp ON cp."userId" = source_calendar."userId"
WHERE sdm."sourceCalendarId" = source_calendar."id";--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ALTER COLUMN "profileId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_profiles" ADD CONSTRAINT "sync_profiles_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_profiles_user_idx" ON "sync_profiles" USING btree ("userId");--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD CONSTRAINT "source_destination_mappings_profileId_sync_profiles_id_fk" FOREIGN KEY ("profileId") REFERENCES "public"."sync_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_destination_mappings_profile_idx" ON "source_destination_mappings" USING btree ("profileId");--> statement-breakpoint
CREATE UNIQUE INDEX "source_destination_mapping_idx" ON "source_destination_mappings" USING btree ("sourceCalendarId","destinationCalendarId","profileId");
