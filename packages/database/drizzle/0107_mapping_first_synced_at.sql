ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "firstSyncedAt" timestamp with time zone;--> statement-breakpoint
UPDATE "source_destination_mappings" SET "firstSyncedAt" = "createdAt" WHERE "firstSyncedAt" IS NULL;
