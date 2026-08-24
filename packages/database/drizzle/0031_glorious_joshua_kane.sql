CREATE TABLE "caldav_event_mappings" (
	"caldavEventStateId" uuid NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deleteIdentifier" text,
	"destinationEventUid" text NOT NULL,
	"destinationId" uuid NOT NULL,
	"endTime" timestamp NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"startTime" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caldav_event_states" (
	"caldavSourceId" uuid NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"endTime" timestamp NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sourceEventUid" text,
	"startTime" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caldav_source_credentials" (
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"encryptedPassword" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"serverUrl" text NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"username" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caldav_source_destination_mappings" (
	"caldavSourceId" uuid NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"destinationId" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caldav_sources" (
	"calendarUrl" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"credentialId" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"syncToken" text,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_source_credentials" (
	"accessToken" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"email" text,
	"expiresAt" timestamp NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"needsReauthentication" boolean DEFAULT false NOT NULL,
	"provider" text NOT NULL,
	"refreshToken" text NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
DROP INDEX "oauth_calendar_sources_user_calendar_idx";--> statement-breakpoint
ALTER TABLE "oauth_calendar_sources" ALTER COLUMN "destinationId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_calendar_sources" ADD COLUMN "oauthSourceCredentialId" uuid;--> statement-breakpoint
ALTER TABLE "caldav_event_mappings" ADD CONSTRAINT "caldav_event_mappings_caldavEventStateId_caldav_event_states_id_fk" FOREIGN KEY ("caldavEventStateId") REFERENCES "public"."caldav_event_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caldav_event_mappings" ADD CONSTRAINT "caldav_event_mappings_destinationId_calendar_destinations_id_fk" FOREIGN KEY ("destinationId") REFERENCES "public"."calendar_destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caldav_event_states" ADD CONSTRAINT "caldav_event_states_caldavSourceId_caldav_sources_id_fk" FOREIGN KEY ("caldavSourceId") REFERENCES "public"."caldav_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caldav_source_destination_mappings" ADD CONSTRAINT "caldav_source_destination_mappings_caldavSourceId_caldav_sources_id_fk" FOREIGN KEY ("caldavSourceId") REFERENCES "public"."caldav_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caldav_source_destination_mappings" ADD CONSTRAINT "caldav_source_destination_mappings_destinationId_calendar_destinations_id_fk" FOREIGN KEY ("destinationId") REFERENCES "public"."calendar_destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caldav_sources" ADD CONSTRAINT "caldav_sources_credentialId_caldav_source_credentials_id_fk" FOREIGN KEY ("credentialId") REFERENCES "public"."caldav_source_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caldav_sources" ADD CONSTRAINT "caldav_sources_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_source_credentials" ADD CONSTRAINT "oauth_source_credentials_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "caldav_event_mappings_event_dest_idx" ON "caldav_event_mappings" USING btree ("caldavEventStateId","destinationId");--> statement-breakpoint
CREATE INDEX "caldav_event_mappings_destination_idx" ON "caldav_event_mappings" USING btree ("destinationId");--> statement-breakpoint
CREATE INDEX "caldav_event_states_start_time_idx" ON "caldav_event_states" USING btree ("startTime");--> statement-breakpoint
CREATE UNIQUE INDEX "caldav_event_states_identity_idx" ON "caldav_event_states" USING btree ("caldavSourceId","sourceEventUid","startTime","endTime");--> statement-breakpoint
CREATE INDEX "caldav_event_states_source_idx" ON "caldav_event_states" USING btree ("caldavSourceId");--> statement-breakpoint
CREATE UNIQUE INDEX "caldav_source_destination_mapping_idx" ON "caldav_source_destination_mappings" USING btree ("caldavSourceId","destinationId");--> statement-breakpoint
CREATE INDEX "caldav_source_destination_mappings_source_idx" ON "caldav_source_destination_mappings" USING btree ("caldavSourceId");--> statement-breakpoint
CREATE INDEX "caldav_source_destination_mappings_destination_idx" ON "caldav_source_destination_mappings" USING btree ("destinationId");--> statement-breakpoint
CREATE INDEX "caldav_sources_user_idx" ON "caldav_sources" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "caldav_sources_provider_idx" ON "caldav_sources" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "caldav_sources_user_calendar_idx" ON "caldav_sources" USING btree ("userId","calendarUrl");--> statement-breakpoint
CREATE INDEX "oauth_source_credentials_user_idx" ON "oauth_source_credentials" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "oauth_source_credentials_provider_idx" ON "oauth_source_credentials" USING btree ("provider");--> statement-breakpoint
ALTER TABLE "oauth_calendar_sources" ADD CONSTRAINT "oauth_calendar_sources_oauthSourceCredentialId_oauth_source_credentials_id_fk" FOREIGN KEY ("oauthSourceCredentialId") REFERENCES "public"."oauth_source_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_calendar_sources_credential_idx" ON "oauth_calendar_sources" USING btree ("oauthSourceCredentialId");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_calendar_sources_user_calendar_idx" ON "oauth_calendar_sources" USING btree ("userId","externalCalendarId","provider");