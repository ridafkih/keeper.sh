UPDATE "calendars" SET "syncHistoricRange" = '1_month' WHERE "syncHistoricRange" NOT IN ('1_week', '1_month', '3_months', '6_months', '12_months', '2_years');--> statement-breakpoint
UPDATE "calendars" SET "syncFutureRange" = '2_years' WHERE "syncFutureRange" NOT IN ('1_week', '1_month', '3_months', '6_months', '12_months', '2_years');--> statement-breakpoint
UPDATE "calendars" SET "ingestHistoricRange" = '1_month' WHERE "ingestHistoricRange" NOT IN ('1_week', '1_month', '3_months', '6_months', '12_months', '2_years');--> statement-breakpoint
UPDATE "calendars" SET "ingestFutureRange" = '2_years' WHERE "ingestFutureRange" NOT IN ('1_week', '1_month', '3_months', '6_months', '12_months', '2_years');--> statement-breakpoint
UPDATE "calendars" SET "ingestWindowStart" = NULL, "ingestWindowEnd" = NULL, "ingestWindowRecordedAt" = NULL WHERE NOT (("ingestWindowStart" IS NULL AND "ingestWindowEnd" IS NULL AND "ingestWindowRecordedAt" IS NULL) OR ("ingestWindowStart" IS NOT NULL AND "ingestWindowEnd" IS NOT NULL AND "ingestWindowRecordedAt" IS NOT NULL AND "ingestWindowStart" < "ingestWindowEnd"));--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendars_sync_ranges_check' AND conrelid = 'calendars'::regclass) THEN
    ALTER TABLE "calendars" ADD CONSTRAINT "calendars_sync_ranges_check" CHECK ("syncHistoricRange" IN ('1_week', '1_month', '3_months', '6_months', '12_months', '2_years') AND "syncFutureRange" IN ('1_week', '1_month', '3_months', '6_months', '12_months', '2_years'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendars_ingest_coverage_check' AND conrelid = 'calendars'::regclass) THEN
    ALTER TABLE "calendars" ADD CONSTRAINT "calendars_ingest_coverage_check" CHECK ("ingestHistoricRange" IN ('1_week', '1_month', '3_months', '6_months', '12_months', '2_years') AND "ingestFutureRange" IN ('1_week', '1_month', '3_months', '6_months', '12_months', '2_years') AND (("ingestWindowStart" IS NULL AND "ingestWindowEnd" IS NULL AND "ingestWindowRecordedAt" IS NULL) OR ("ingestWindowStart" IS NOT NULL AND "ingestWindowEnd" IS NOT NULL AND "ingestWindowRecordedAt" IS NOT NULL AND "ingestWindowStart" < "ingestWindowEnd")));
  END IF;
END $$;
