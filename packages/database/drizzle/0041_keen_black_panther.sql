CREATE TABLE "profile_calendars" (
	"calendarId" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profileId" uuid NOT NULL,
	"role" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_calendars" ADD CONSTRAINT "profile_calendars_calendarId_calendars_id_fk" FOREIGN KEY ("calendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_calendars" ADD CONSTRAINT "profile_calendars_profileId_sync_profiles_id_fk" FOREIGN KEY ("profileId") REFERENCES "public"."sync_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_calendars_unique_idx" ON "profile_calendars" USING btree ("profileId","calendarId","role");--> statement-breakpoint
CREATE INDEX "profile_calendars_profile_idx" ON "profile_calendars" USING btree ("profileId");