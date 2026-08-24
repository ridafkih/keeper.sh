ALTER TABLE "calendars" ADD COLUMN "includeInIcalFeed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "calendars" SET "includeInIcalFeed" = true;
