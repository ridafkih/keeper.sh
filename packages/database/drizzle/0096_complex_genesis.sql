ALTER TABLE "calendars" ADD COLUMN IF NOT EXISTS "excludeAvailabilities" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN IF NOT EXISTS "excludeTitleKeywords" text[] DEFAULT '{}' NOT NULL;
