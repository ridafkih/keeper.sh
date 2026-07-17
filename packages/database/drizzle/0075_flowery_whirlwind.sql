ALTER TABLE "event_states" ADD COLUMN "sourceEventId" text;--> statement-breakpoint
DROP INDEX "event_states_identity_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "event_states_source_event_idx" ON "event_states" USING btree ("calendarId","sourceEventId") WHERE "event_states"."sourceEventId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_states_identity_idx" ON "event_states" USING btree ("calendarId","sourceEventUid","startTime","endTime") WHERE "event_states"."sourceEventId" is null;
