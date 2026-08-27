ALTER TABLE "calendars" ADD COLUMN IF NOT EXISTS "verificationCursor" text;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "consecutiveUpdateFailures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "consecutiveUnsettledReads" integer DEFAULT 0 NOT NULL;
