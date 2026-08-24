DELETE FROM "event_mappings";--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN "startTime" timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN "endTime" timestamp NOT NULL;