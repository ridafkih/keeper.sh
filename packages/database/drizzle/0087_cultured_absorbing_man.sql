CREATE TABLE IF NOT EXISTS "event_write_back_tombstones" (
	"appliedAt" timestamp DEFAULT now() NOT NULL,
	"destinationCalendarId" uuid NOT NULL,
	"eventMappingId" uuid NOT NULL,
	"eventStateId" uuid,
	"expiresAt" timestamp NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"observedAt" timestamp,
	"snapshot" jsonb NOT NULL,
	"sourceCalendarId" uuid NOT NULL,
	"sourceEventUid" text NOT NULL,
	"state" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "destinationAvailability" text;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "destinationContentHash" text;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "destinationDescription" text;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "destinationEndTime" timestamp;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "destinationIsAllDay" boolean;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "destinationLocation" text;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "destinationStartTime" timestamp;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "destinationSummary" text;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "missingFirstObservedAt" timestamp;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "missingObservationCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "writeBackDailyCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "writeBackDailyWindowStart" timestamp;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "writeBackEpoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD COLUMN IF NOT EXISTS "writeBackEpochWindowStart" timestamp;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "deleteConfirmationApprovedAt" timestamp;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "writeBackEnabledAt" timestamp;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "writeBackMode" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "writeBackState" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "writeBackStateReason" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_write_back_tombstones_source_idx" ON "event_write_back_tombstones" USING btree ("sourceCalendarId","appliedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_write_back_tombstones_expiry_idx" ON "event_write_back_tombstones" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_write_back_tombstones_mapping_idx" ON "event_write_back_tombstones" USING btree ("eventMappingId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_mappings_pending_delete_idx" ON "event_mappings" USING btree ("calendarId","missingFirstObservedAt") WHERE "event_mappings"."missingFirstObservedAt" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_destination_mappings_write_back_idx" ON "source_destination_mappings" USING btree ("writeBackMode") WHERE "source_destination_mappings"."writeBackMode" <> 'off';