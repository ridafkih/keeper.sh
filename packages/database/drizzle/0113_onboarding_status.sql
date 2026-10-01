ALTER TABLE "user" ADD COLUMN "onboardingStatus" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "onboardingStatus" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_onboarding_status_check" CHECK ("onboardingStatus" IN ('pending', 'completed', 'skipped'));
