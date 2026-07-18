DROP INDEX "event_mappings_event_cal_idx";--> statement-breakpoint
DROP INDEX "event_states_identity_idx";--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN "syncEventId" text;--> statement-breakpoint
CREATE UNIQUE INDEX "event_mappings_sync_event_cal_idx" ON "event_mappings" USING btree ("calendarId","syncEventId") WHERE "event_mappings"."syncEventId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_states_recurring_instance_idx" ON "event_states" USING btree ("calendarId","sourceEventUid","recurrenceId") WHERE "event_states"."sourceEventId" is null and "event_states"."recurrenceId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_states_non_recurring_instance_idx" ON "event_states" USING btree ("calendarId","sourceEventUid","startTime","endTime") WHERE "event_states"."sourceEventId" is null and "event_states"."recurrenceId" is null;