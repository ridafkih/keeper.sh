ALTER TABLE "deletion_residue" ADD COLUMN IF NOT EXISTS "accountEmail" text;--> statement-breakpoint
ALTER TABLE "deletion_residue" ADD COLUMN IF NOT EXISTS "providerAccountId" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_accounts_oauth_credential_idx" ON "calendar_accounts" USING btree ("oauthCredentialId");