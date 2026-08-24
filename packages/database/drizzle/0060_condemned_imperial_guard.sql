UPDATE "calendar_accounts"
SET "needsReauthentication" = false
WHERE "needsReauthentication" = true;
--> statement-breakpoint
UPDATE "oauth_credentials"
SET "needsReauthentication" = false
WHERE "needsReauthentication" = true;
