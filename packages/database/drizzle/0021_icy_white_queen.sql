TRUNCATE TABLE "sync_status";--> statement-breakpoint
ALTER TABLE "sync_status" DROP CONSTRAINT "sync_status_userId_user_id_fk";--> statement-breakpoint
DROP INDEX "sync_status_user_provider_idx";--> statement-breakpoint
ALTER TABLE "sync_status" ADD COLUMN "destinationId" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_status" ADD CONSTRAINT "sync_status_destinationId_calendar_destinations_id_fk" FOREIGN KEY ("destinationId") REFERENCES "public"."calendar_destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_status_destination_idx" ON "sync_status" USING btree ("destinationId");--> statement-breakpoint
ALTER TABLE "sync_status" DROP COLUMN "userId";--> statement-breakpoint
ALTER TABLE "sync_status" DROP COLUMN "provider";