ALTER TABLE "calendars" ADD COLUMN "failureCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "lastFailureAt" timestamp;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "nextAttemptAt" timestamp;