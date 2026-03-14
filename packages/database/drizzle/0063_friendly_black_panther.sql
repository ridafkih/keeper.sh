CREATE TABLE "user_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendarId" uuid NOT NULL,
	"userId" text NOT NULL,
	"sourceEventUid" text,
	"title" text,
	"description" text,
	"location" text,
	"availability" text,
	"isAllDay" boolean,
	"startTime" timestamp NOT NULL,
	"endTime" timestamp NOT NULL,
	"startTimeZone" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_calendarId_calendars_id_fk" FOREIGN KEY ("calendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_events_user_idx" ON "user_events" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "user_events_calendar_idx" ON "user_events" USING btree ("calendarId");--> statement-breakpoint
CREATE INDEX "user_events_start_time_idx" ON "user_events" USING btree ("startTime");--> statement-breakpoint
CREATE INDEX "user_events_end_time_idx" ON "user_events" USING btree ("endTime");