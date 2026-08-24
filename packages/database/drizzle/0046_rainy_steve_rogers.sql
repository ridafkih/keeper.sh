ALTER TABLE "event_states" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "title" text;
--> statement-breakpoint
UPDATE "calendars"
SET "syncToken" = null
WHERE "calendarType" IN ('oauth', 'caldav');
