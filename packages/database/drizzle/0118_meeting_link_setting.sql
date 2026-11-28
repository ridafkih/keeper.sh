ALTER TABLE "calendars" ADD COLUMN IF NOT EXISTS "excludeEventMeetingLink" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN IF NOT EXISTS "meetingLink" text;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "excludeEventMeetingLink" boolean;