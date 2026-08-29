ALTER TABLE "deletion_residue" ADD COLUMN "accountEmail" text;--> statement-breakpoint
ALTER TABLE "deletion_residue" ADD COLUMN "providerAccountId" text;--> statement-breakpoint
CREATE INDEX "calendar_accounts_oauth_credential_idx" ON "calendar_accounts" USING btree ("oauthCredentialId");