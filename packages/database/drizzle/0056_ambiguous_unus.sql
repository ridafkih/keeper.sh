ALTER TABLE "event_states" ADD COLUMN "sourceEventType" text;
--> statement-breakpoint
UPDATE "calendars"
SET "syncToken" = null
WHERE "calendarType" IN ('oauth', 'caldav');
