ALTER TABLE "calendars" ADD COLUMN IF NOT EXISTS "color" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN IF NOT EXISTS "color" text;