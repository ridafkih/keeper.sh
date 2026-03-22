UPDATE "calendar_accounts"
SET "needsReauthentication" = false
WHERE "provider" IN ('caldav', 'icloud', 'fastmail')
  AND "needsReauthentication" = true;