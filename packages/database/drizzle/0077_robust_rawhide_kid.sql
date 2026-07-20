ALTER TABLE "event_mappings" DROP CONSTRAINT "event_mappings_eventStateId_event_states_id_fk";
--> statement-breakpoint
ALTER TABLE "event_mappings" ALTER COLUMN "eventStateId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "ingestFutureRange" text DEFAULT '2_years' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "ingestHistoricRange" text DEFAULT '1_week' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "ingestWindowEnd" timestamp;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "ingestWindowStart" timestamp;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "syncFutureRange" text DEFAULT '2_years' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "syncHistoricRange" text DEFAULT '1_week' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN "sourceCalendarId" uuid;--> statement-breakpoint
UPDATE "event_mappings"
SET "sourceCalendarId" = "event_states"."calendarId"
FROM "event_states"
WHERE "event_mappings"."eventStateId" = "event_states"."id";--> statement-breakpoint
ALTER TABLE "event_mappings" ALTER COLUMN "sourceCalendarId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD CONSTRAINT "event_mappings_sourceCalendarId_calendars_id_fk" FOREIGN KEY ("sourceCalendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD CONSTRAINT "event_mappings_eventStateId_event_states_id_fk" FOREIGN KEY ("eventStateId") REFERENCES "public"."event_states"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_mappings_source_calendar_idx" ON "event_mappings" USING btree ("sourceCalendarId");
