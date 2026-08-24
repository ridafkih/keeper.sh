ALTER TABLE "calendar_snapshots" DROP CONSTRAINT "calendar_snapshots_userId_user_id_fk";
--> statement-breakpoint
DELETE FROM "calendar_snapshots";
--> statement-breakpoint
ALTER TABLE "calendar_snapshots" ADD COLUMN "sourceId" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_snapshots" ADD CONSTRAINT "calendar_snapshots_sourceId_remote_ical_sources_id_fk" FOREIGN KEY ("sourceId") REFERENCES "public"."remote_ical_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_snapshots" DROP COLUMN "userId";