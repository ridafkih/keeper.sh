ALTER TABLE "calendars" ADD COLUMN "ingestFailureCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "ingestLastFailureAt" timestamp;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "ingestNextAttemptAt" timestamp;