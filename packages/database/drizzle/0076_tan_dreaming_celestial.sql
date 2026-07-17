DROP INDEX "event_states_identity_idx";--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "sourceEventInstanceKey" text;--> statement-breakpoint
CREATE UNIQUE INDEX "event_states_instance_idx" ON "event_states" USING btree ("calendarId","sourceEventInstanceKey") WHERE "event_states"."sourceEventId" is null;