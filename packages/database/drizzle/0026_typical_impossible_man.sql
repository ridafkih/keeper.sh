ALTER TABLE "event_mappings" ADD COLUMN "deleteIdentifier" text;--> statement-breakpoint
UPDATE "event_mappings" SET "deleteIdentifier" = "destinationEventUid" WHERE "deleteIdentifier" IS NULL;