CREATE TABLE "sync_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"provider" text NOT NULL,
	"localEventCount" integer DEFAULT 0 NOT NULL,
	"remoteEventCount" integer DEFAULT 0 NOT NULL,
	"lastSyncedAt" timestamp,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_status" ADD CONSTRAINT "sync_status_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_status_user_provider_idx" ON "sync_status" USING btree ("userId","provider");--> statement-breakpoint
CREATE INDEX "event_states_start_time_idx" ON "event_states" USING btree ("startTime");