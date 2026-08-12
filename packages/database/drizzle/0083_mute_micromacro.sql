ALTER TABLE "calendar_accounts" ADD COLUMN IF NOT EXISTS "calendarsRefreshAttemptedAt" timestamp;--> statement-breakpoint
ALTER TABLE "calendar_accounts" ADD COLUMN IF NOT EXISTS "calendarsRefreshedAt" timestamp;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN IF NOT EXISTS "unavailableSince" timestamp;