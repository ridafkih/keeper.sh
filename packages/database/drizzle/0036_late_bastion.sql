ALTER TABLE "calendar_sources" ADD COLUMN IF NOT EXISTS "excludeFocusTime" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD COLUMN IF NOT EXISTS "excludeOutOfOffice" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD COLUMN IF NOT EXISTS "excludeWorkingLocation" boolean DEFAULT false NOT NULL;
