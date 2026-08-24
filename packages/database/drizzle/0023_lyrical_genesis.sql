CREATE TABLE "caldav_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"serverUrl" text NOT NULL,
	"calendarUrl" text NOT NULL,
	"username" text NOT NULL,
	"encryptedPassword" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accessToken" text NOT NULL,
	"refreshToken" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_destinations" ADD COLUMN "oauthCredentialId" uuid;--> statement-breakpoint
ALTER TABLE "calendar_destinations" ADD COLUMN "caldavCredentialId" uuid;--> statement-breakpoint
ALTER TABLE "calendar_destinations" ADD CONSTRAINT "calendar_destinations_oauthCredentialId_oauth_credentials_id_fk" FOREIGN KEY ("oauthCredentialId") REFERENCES "public"."oauth_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_destinations" ADD CONSTRAINT "calendar_destinations_caldavCredentialId_caldav_credentials_id_fk" FOREIGN KEY ("caldavCredentialId") REFERENCES "public"."caldav_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_destinations" DROP COLUMN "accessToken";--> statement-breakpoint
ALTER TABLE "calendar_destinations" DROP COLUMN "refreshToken";--> statement-breakpoint
ALTER TABLE "calendar_destinations" DROP COLUMN "accessTokenExpiresAt";