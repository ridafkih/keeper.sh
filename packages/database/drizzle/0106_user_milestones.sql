CREATE TABLE IF NOT EXISTS "user_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone" text NOT NULL,
	"reachedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "user_milestones_milestone_check" CHECK ("milestone" IN ('first_calendar_connected', 'first_sync_created', 'first_events_copied'))
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_milestones_userId_user_id_fk' AND conrelid = 'user_milestones'::regclass) THEN
    ALTER TABLE "user_milestones" ADD CONSTRAINT "user_milestones_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_milestones_user_milestone_idx" ON "user_milestones" USING btree ("userId","milestone");
