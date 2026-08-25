ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "remoteContentHash" text;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "remoteStartTime" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "remoteEndTime" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "remoteAvailability" text;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "remoteContentHashRepairedFrom" text;
