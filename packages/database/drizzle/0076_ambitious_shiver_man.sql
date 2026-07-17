DROP INDEX "event_mappings_event_cal_idx";--> statement-breakpoint
DROP INDEX "event_states_identity_idx";--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN "syncEventId" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "sourceEventInstanceKey" text GENERATED ALWAYS AS (
      case
        when "recurrenceId" is not null then
          'recurrence|' || coalesce("sourceEventUid", '') || '|' || extract(epoch from "recurrenceId")
        else
          'slot|' || coalesce("sourceEventUid", '') || '|' || extract(epoch from "startTime") || '|' || extract(epoch from "endTime")
      end
    ) STORED;--> statement-breakpoint
CREATE UNIQUE INDEX "event_mappings_sync_event_cal_idx" ON "event_mappings" USING btree ("calendarId","syncEventId") WHERE "event_mappings"."syncEventId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_states_instance_idx" ON "event_states" USING btree ("calendarId","sourceEventInstanceKey") WHERE "event_states"."sourceEventId" is null;