CREATE TABLE IF NOT EXISTS "calendar_removals" (
	"accountId" uuid NOT NULL,
	"calendarType" text NOT NULL,
	"calendarUrl" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"externalCalendarId" text,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN IF NOT EXISTS "providerMissingSince" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calendar_removals_accountId_calendar_accounts_id_fk'
      AND conrelid = 'calendar_removals'::regclass
  ) THEN
    ALTER TABLE "calendar_removals" ADD CONSTRAINT "calendar_removals_accountId_calendar_accounts_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."calendar_accounts"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calendar_removals_userId_user_id_fk'
      AND conrelid = 'calendar_removals'::regclass
  ) THEN
    ALTER TABLE "calendar_removals" ADD CONSTRAINT "calendar_removals_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_removals_account_idx" ON "calendar_removals" USING btree ("accountId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_removals_external_idx" ON "calendar_removals" USING btree ("accountId","externalCalendarId") WHERE "calendar_removals"."externalCalendarId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_removals_url_idx" ON "calendar_removals" USING btree ("accountId","calendarUrl") WHERE "calendar_removals"."calendarUrl" is not null;
