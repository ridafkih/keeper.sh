DROP TABLE IF EXISTS "users" CASCADE;--> statement-breakpoint
ALTER TABLE "calendar_snapshots" DROP CONSTRAINT IF EXISTS "calendar_snapshots_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "calendars" DROP CONSTRAINT IF EXISTS "calendars_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "event_states" DROP CONSTRAINT IF EXISTS "event_states_calendarId_calendars_id_fk";
--> statement-breakpoint
ALTER TABLE "remote_ical_sources" DROP CONSTRAINT IF EXISTS "remote_ical_sources_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "calendar_snapshots" ALTER COLUMN "userId" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "userId" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "remote_ical_sources" ALTER COLUMN "userId" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "calendar_snapshots" ADD CONSTRAINT "calendar_snapshots_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_states" ADD CONSTRAINT "event_states_calendarId_calendars_id_fk" FOREIGN KEY ("calendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_ical_sources" ADD CONSTRAINT "remote_ical_sources_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
