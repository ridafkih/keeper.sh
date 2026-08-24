CREATE TABLE "oauth_calendar_sources" (
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"destinationId" uuid NOT NULL,
	"externalCalendarId" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"syncToken" text,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_event_mappings" (
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deleteIdentifier" text,
	"destinationEventUid" text NOT NULL,
	"destinationId" uuid NOT NULL,
	"endTime" timestamp NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oauthEventStateId" uuid NOT NULL,
	"startTime" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_event_states" (
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"endTime" timestamp NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oauthSourceId" uuid NOT NULL,
	"sourceEventUid" text,
	"startTime" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_source_destination_mappings" (
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"destinationId" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oauthSourceId" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_calendar_sources" ADD CONSTRAINT "oauth_calendar_sources_destinationId_calendar_destinations_id_fk" FOREIGN KEY ("destinationId") REFERENCES "public"."calendar_destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_calendar_sources" ADD CONSTRAINT "oauth_calendar_sources_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_event_mappings" ADD CONSTRAINT "oauth_event_mappings_destinationId_calendar_destinations_id_fk" FOREIGN KEY ("destinationId") REFERENCES "public"."calendar_destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_event_mappings" ADD CONSTRAINT "oauth_event_mappings_oauthEventStateId_oauth_event_states_id_fk" FOREIGN KEY ("oauthEventStateId") REFERENCES "public"."oauth_event_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_event_states" ADD CONSTRAINT "oauth_event_states_oauthSourceId_oauth_calendar_sources_id_fk" FOREIGN KEY ("oauthSourceId") REFERENCES "public"."oauth_calendar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_source_destination_mappings" ADD CONSTRAINT "oauth_source_destination_mappings_destinationId_calendar_destinations_id_fk" FOREIGN KEY ("destinationId") REFERENCES "public"."calendar_destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_source_destination_mappings" ADD CONSTRAINT "oauth_source_destination_mappings_oauthSourceId_oauth_calendar_sources_id_fk" FOREIGN KEY ("oauthSourceId") REFERENCES "public"."oauth_calendar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_calendar_sources_user_calendar_idx" ON "oauth_calendar_sources" USING btree ("userId","destinationId","externalCalendarId");--> statement-breakpoint
CREATE INDEX "oauth_calendar_sources_user_idx" ON "oauth_calendar_sources" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "oauth_calendar_sources_destination_idx" ON "oauth_calendar_sources" USING btree ("destinationId");--> statement-breakpoint
CREATE INDEX "oauth_calendar_sources_provider_idx" ON "oauth_calendar_sources" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_event_mappings_event_dest_idx" ON "oauth_event_mappings" USING btree ("oauthEventStateId","destinationId");--> statement-breakpoint
CREATE INDEX "oauth_event_mappings_destination_idx" ON "oauth_event_mappings" USING btree ("destinationId");--> statement-breakpoint
CREATE INDEX "oauth_event_states_start_time_idx" ON "oauth_event_states" USING btree ("startTime");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_event_states_identity_idx" ON "oauth_event_states" USING btree ("oauthSourceId","sourceEventUid","startTime","endTime");--> statement-breakpoint
CREATE INDEX "oauth_event_states_source_idx" ON "oauth_event_states" USING btree ("oauthSourceId");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_source_destination_mapping_idx" ON "oauth_source_destination_mappings" USING btree ("oauthSourceId","destinationId");--> statement-breakpoint
CREATE INDEX "oauth_source_destination_mappings_source_idx" ON "oauth_source_destination_mappings" USING btree ("oauthSourceId");--> statement-breakpoint
CREATE INDEX "oauth_source_destination_mappings_destination_idx" ON "oauth_source_destination_mappings" USING btree ("destinationId");