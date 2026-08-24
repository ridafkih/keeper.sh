ALTER TABLE "calendar_sources" ADD COLUMN "excludeFocusTime" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD COLUMN "excludeOutOfOffice" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD COLUMN "excludeWorkingLocation" boolean DEFAULT false NOT NULL;