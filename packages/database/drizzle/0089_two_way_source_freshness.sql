ALTER TABLE "calendars" ADD COLUMN IF NOT EXISTS "ingestLastSucceededAt" timestamp;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "writeBackLastAppliedAt" timestamp;
