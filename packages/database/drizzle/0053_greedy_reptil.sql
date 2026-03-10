ALTER TABLE "user_subscriptions" ADD COLUMN "grandfathered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD COLUMN "grandfatheredAt" timestamp;