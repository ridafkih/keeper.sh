DELETE FROM "event_write_back_tombstones";--> statement-breakpoint
ALTER TABLE "event_write_back_tombstones" ADD COLUMN IF NOT EXISTS "userId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "event_write_back_tombstones" DROP CONSTRAINT IF EXISTS "event_write_back_tombstones_userId_user_id_fk";--> statement-breakpoint
ALTER TABLE "event_write_back_tombstones" ADD CONSTRAINT "event_write_back_tombstones_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_write_back_tombstones_user_idx" ON "event_write_back_tombstones" USING btree ("userId");
