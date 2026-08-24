ALTER TABLE "source_destination_mappings" DROP CONSTRAINT IF EXISTS "source_destination_mappings_profileId_sync_profiles_id_fk";
--> statement-breakpoint
DROP INDEX "source_destination_mappings_profile_idx";--> statement-breakpoint
DROP INDEX "source_destination_mapping_idx";--> statement-breakpoint
-- Deduplicate rows that differ only by profileId before dropping the column
DELETE FROM "source_destination_mappings" a
  USING "source_destination_mappings" b
  WHERE a."sourceCalendarId" = b."sourceCalendarId"
    AND a."destinationCalendarId" = b."destinationCalendarId"
    AND a."createdAt" > b."createdAt";--> statement-breakpoint
ALTER TABLE "source_destination_mappings" DROP COLUMN "profileId";--> statement-breakpoint
CREATE UNIQUE INDEX "source_destination_mapping_idx" ON "source_destination_mappings" USING btree ("sourceCalendarId","destinationCalendarId");--> statement-breakpoint
ALTER TABLE "profile_calendars" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_profiles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "profile_calendars" CASCADE;--> statement-breakpoint
DROP TABLE "sync_profiles" CASCADE;
