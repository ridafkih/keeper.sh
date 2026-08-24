ALTER TABLE "calendars" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "calendars" CASCADE;--> statement-breakpoint
DELETE FROM "event_states";--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "sourceId" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "event_states" ADD CONSTRAINT "event_states_sourceId_remote_ical_sources_id_fk" FOREIGN KEY ("sourceId") REFERENCES "public"."remote_ical_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_states" DROP COLUMN "calendarId";