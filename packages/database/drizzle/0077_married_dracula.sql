CREATE TABLE "user_sync_requests" (
	"requestId" uuid DEFAULT gen_random_uuid() NOT NULL,
	"requestedAt" timestamp DEFAULT now() NOT NULL,
	"userId" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_mappings" ALTER COLUMN "eventStateId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "ingestFutureRange" text DEFAULT '2_years' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "ingestHistoricRange" text DEFAULT '1_month' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "ingestWindowEnd" timestamp;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "ingestWindowRecordedAt" timestamp;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "ingestWindowStart" timestamp;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "syncFutureRange" text DEFAULT '2_years' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "syncHistoricRange" text DEFAULT '1_month' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN "sourceCalendarId" uuid;--> statement-breakpoint
ALTER TABLE "user_sync_requests" ADD CONSTRAINT "user_sync_requests_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;