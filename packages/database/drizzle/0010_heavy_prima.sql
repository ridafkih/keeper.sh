ALTER TABLE "calendar_snapshots" ALTER COLUMN "ical" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_snapshots" DROP COLUMN "json";