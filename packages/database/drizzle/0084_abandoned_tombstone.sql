CREATE TABLE IF NOT EXISTS "calendar_push_channels" (
	"accountId" uuid NOT NULL,
	"calendarId" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp,
	"failureCount" integer DEFAULT 0 NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lastFailureAt" timestamp,
	"lastNotificationAt" timestamp,
	"nextAttemptAt" timestamp,
	"provider" text NOT NULL,
	"providerChannelId" text,
	"providerResourceId" text,
	"reauthorizeRequestedAt" timestamp,
	"resourcePath" text,
	"secretHash" text NOT NULL,
	"state" text DEFAULT 'registering' NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"userId" text NOT NULL,
	"verifiedAt" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calendar_push_channels_accountId_calendar_accounts_id_fk'
      AND conrelid = 'calendar_push_channels'::regclass
  ) THEN
    ALTER TABLE "calendar_push_channels" ADD CONSTRAINT "calendar_push_channels_accountId_calendar_accounts_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."calendar_accounts"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calendar_push_channels_calendarId_calendars_id_fk'
      AND conrelid = 'calendar_push_channels'::regclass
  ) THEN
    ALTER TABLE "calendar_push_channels" ADD CONSTRAINT "calendar_push_channels_calendarId_calendars_id_fk" FOREIGN KEY ("calendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calendar_push_channels_userId_user_id_fk'
      AND conrelid = 'calendar_push_channels'::regclass
  ) THEN
    ALTER TABLE "calendar_push_channels" ADD CONSTRAINT "calendar_push_channels_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_push_channels_account_idx" ON "calendar_push_channels" USING btree ("accountId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_push_channels_expiry_idx" ON "calendar_push_channels" USING btree ("state","expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_push_channels_provider_channel_idx" ON "calendar_push_channels" USING btree ("provider","providerChannelId") WHERE "calendar_push_channels"."providerChannelId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_push_channels_scope_idx" ON "calendar_push_channels" USING btree ("provider","calendarId") WHERE "calendar_push_channels"."calendarId" is not null and "calendar_push_channels"."state" in ('registering', 'active', 'degraded');