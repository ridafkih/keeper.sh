ALTER TABLE "user_subscriptions" ALTER COLUMN "plan" SET DEFAULT 'pro';--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD COLUMN "grandfatheredPlan" text;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD COLUMN "trialEndsAt" timestamp;--> statement-breakpoint
UPDATE "user_subscriptions" SET "grandfatheredPlan" = 'pro' WHERE "plan" = 'free';--> statement-breakpoint
UPDATE "user_subscriptions" SET "grandfatheredPlan" = 'unlimited' WHERE "plan" = 'pro' AND "polarSubscriptionId" IS NOT NULL;--> statement-breakpoint
UPDATE "user_subscriptions" SET "plan" = 'pro' WHERE "plan" = 'free';
