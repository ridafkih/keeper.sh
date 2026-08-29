CREATE TABLE IF NOT EXISTS "deletion_residue" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"credentialExpiresAt" timestamp with time zone,
	"encryptedAccessToken" text,
	"encryptedRefreshToken" text,
	"expiresAt" timestamp with time zone NOT NULL,
	"externalId" text,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"lastAttemptAt" timestamp with time zone,
	"nextAttemptAt" timestamp with time zone,
	"provider" text,
	"providerChannelId" text,
	"providerResourceId" text,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deletion_residue_due_idx" ON "deletion_residue" USING btree ("nextAttemptAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deletion_residue_user_idx" ON "deletion_residue" USING btree ("userId");