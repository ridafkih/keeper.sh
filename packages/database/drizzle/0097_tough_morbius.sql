DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendars' AND column_name = 'excludeFreeEvents') THEN
    UPDATE "calendars" SET "excludeAvailabilities" = array_append("excludeAvailabilities", 'free') WHERE "excludeFreeEvents" AND NOT ('free' = ANY("excludeAvailabilities"));
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "calendars" DROP COLUMN IF EXISTS "excludeFreeEvents";
