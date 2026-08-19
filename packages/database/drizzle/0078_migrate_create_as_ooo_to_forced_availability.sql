DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'calendars'
      AND column_name = 'createAsOutOfOffice'
  ) THEN
    ALTER TABLE "calendars" ADD COLUMN IF NOT EXISTS "forcedAvailability" text;
    UPDATE "calendars"
    SET "forcedAvailability" = 'oof'
    WHERE "createAsOutOfOffice" = true
      AND "forcedAvailability" IS NULL;
    ALTER TABLE "calendars" DROP COLUMN "createAsOutOfOffice";
  END IF;
END $$;
