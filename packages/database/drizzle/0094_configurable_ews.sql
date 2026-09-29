CREATE TABLE "ews_calendar_state" (
	"calendarId" uuid PRIMARY KEY NOT NULL,
	"lastReadAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ews_credentials" (
	"accountId" uuid PRIMARY KEY NOT NULL,
	"encryptedConfig" text NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ews_calendar_state" ADD CONSTRAINT "ews_calendar_state_calendarId_calendars_id_fk" FOREIGN KEY ("calendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ews_credentials" ADD CONSTRAINT "ews_credentials_accountId_calendar_accounts_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."calendar_accounts"("id") ON DELETE cascade ON UPDATE no action;