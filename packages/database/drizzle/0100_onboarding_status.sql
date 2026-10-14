ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "onboardingStatus" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "onboardingStatus" SET DEFAULT 'pending';--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_onboarding_status_check'
      AND conrelid = 'user'::regclass
  ) THEN
    ALTER TABLE "user" ADD CONSTRAINT "user_onboarding_status_check" CHECK ("onboardingStatus" IN ('pending', 'completed', 'skipped'));
  END IF;
END $$;
