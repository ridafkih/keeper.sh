DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_mappings_eventStateId_event_states_id_fk'
      AND conrelid = 'event_mappings'::regclass
      AND confdeltype = 'n'
  ) THEN
    ALTER TABLE "event_mappings"
      DROP CONSTRAINT IF EXISTS "event_mappings_eventStateId_event_states_id_fk",
      ADD CONSTRAINT "event_mappings_eventStateId_event_states_id_fk"
        FOREIGN KEY ("eventStateId") REFERENCES "public"."event_states"("id")
        ON DELETE set null ON UPDATE no action NOT VALID;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_mappings_source_calendar_idx" ON "event_mappings" USING btree ("sourceCalendarId");--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_mappings_identity_check'
      AND conrelid = 'event_mappings'::regclass
  ) THEN
    ALTER TABLE "event_mappings" ADD CONSTRAINT "event_mappings_identity_check" CHECK ("event_mappings"."eventStateId" is not null or "event_mappings"."syncEventId" is not null) NOT VALID;
  END IF;
END $$;
