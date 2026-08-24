CREATE TABLE "calendar_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"provider" text NOT NULL,
	"accountId" text NOT NULL,
	"email" text,
	"accessToken" text NOT NULL,
	"refreshToken" text NOT NULL,
	"accessTokenExpiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_destinations" ADD CONSTRAINT "calendar_destinations_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_destinations_user_provider_idx" ON "calendar_destinations" USING btree ("userId","provider");--> statement-breakpoint
INSERT INTO "calendar_destinations" ("id", "userId", "provider", "accountId", "accessToken", "refreshToken", "accessTokenExpiresAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "userId", 'google', "accountId", "accessToken", "refreshToken", "accessTokenExpiresAt", "createdAt", "updatedAt"
FROM "account"
WHERE "providerId" = 'google'
  AND "accessToken" IS NOT NULL
  AND "refreshToken" IS NOT NULL
  AND "accessTokenExpiresAt" IS NOT NULL;