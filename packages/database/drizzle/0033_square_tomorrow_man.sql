DROP TABLE IF EXISTS "caldav_event_mappings" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "caldav_event_states" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "caldav_source_destination_mappings" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "caldav_sources" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "oauth_calendar_sources" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "oauth_event_mappings" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "oauth_event_states" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "oauth_source_destination_mappings" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "remote_ical_sources" CASCADE;--> statement-breakpoint
-- Update calendar_snapshots FK to point to unified calendar_sources
ALTER TABLE "calendar_snapshots" DROP CONSTRAINT IF EXISTS "calendar_snapshots_sourceId_remote_ical_sources_id_fk";
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calendar_snapshots_sourceId_calendar_sources_id_fk'
  ) THEN
    ALTER TABLE "calendar_snapshots" ADD CONSTRAINT "calendar_snapshots_sourceId_calendar_sources_id_fk" FOREIGN KEY ("sourceId") REFERENCES "public"."calendar_sources"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
