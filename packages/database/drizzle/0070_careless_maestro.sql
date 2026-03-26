ALTER TABLE "user_subscriptions" ALTER COLUMN "plan" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ALTER COLUMN "plan" DROP NOT NULL;