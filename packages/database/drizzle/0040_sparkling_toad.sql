ALTER TABLE "calendar_accounts" ADD COLUMN "displayName" text;
--> statement-breakpoint
UPDATE "calendar_accounts" AS account
SET "email" = oauth."email"
FROM "oauth_credentials" AS oauth
WHERE account."oauthCredentialId" = oauth."id"
  AND (account."email" IS NULL OR btrim(account."email") = '')
  AND oauth."email" IS NOT NULL
  AND btrim(oauth."email") <> '';
--> statement-breakpoint
UPDATE "calendar_accounts" AS account
SET "email" = credential."username"
FROM "caldav_credentials" AS credential
WHERE account."caldavCredentialId" = credential."id"
  AND (account."email" IS NULL OR btrim(account."email") = '')
  AND credential."username" IS NOT NULL
  AND btrim(credential."username") <> '';
--> statement-breakpoint
UPDATE "calendar_accounts" AS account
SET "accountId" = COALESCE(
  NULLIF(btrim(account."email"), ''),
  (
    SELECT COALESCE(
      NULLIF(btrim(calendar."url"), ''),
      NULLIF(btrim(calendar."calendarUrl"), ''),
      NULLIF(btrim(calendar."externalCalendarId"), '')
    )
    FROM "calendars" AS calendar
    WHERE calendar."accountId" = account."id"
    ORDER BY calendar."createdAt" ASC
    LIMIT 1
  )
)
WHERE account."accountId" IS NULL OR btrim(account."accountId") = '';
--> statement-breakpoint
UPDATE "calendar_accounts" AS account
SET "displayName" = CASE
	WHEN lower(account."provider") = 'ics' THEN COALESCE(
		(
			SELECT COALESCE(NULLIF(btrim(calendar."url"), ''), NULLIF(btrim(calendar."calendarUrl"), ''))
			FROM "calendars" AS calendar
			WHERE calendar."accountId" = account."id"
			ORDER BY calendar."createdAt" ASC
			LIMIT 1
		),
		NULLIF(btrim(account."accountId"), ''),
		NULLIF(btrim(account."email"), ''),
		'iCal'
	)
	WHEN lower(account."provider") = 'caldav' THEN COALESCE(
		NULLIF(btrim(account."email"), ''),
		NULLIF(btrim(account."accountId"), ''),
		'CalDAV'
	)
	WHEN lower(account."provider") = 'icloud' THEN COALESCE(
		NULLIF(btrim(account."email"), ''),
		NULLIF(btrim(account."accountId"), ''),
		'iCloud'
	)
	ELSE COALESCE(
		NULLIF(btrim(account."email"), ''),
		NULLIF(btrim(account."accountId"), ''),
		initcap(replace(replace(account."provider", '_', ' '), '-', ' '))
	)
END
WHERE account."displayName" IS NULL OR btrim(account."displayName") = '';
--> statement-breakpoint
CREATE TEMP TABLE "tmp_calendar_account_id_map_0040" AS
WITH ranked_calendar_accounts AS (
  SELECT
    calendar_account."id" AS "oldAccountId",
    FIRST_VALUE(calendar_account."id") OVER (
      PARTITION BY
        calendar_account."userId",
        calendar_account."provider",
        calendar_account."authType",
        COALESCE(
          NULLIF(lower(btrim(calendar_account."email")), ''),
          NULLIF(lower(btrim(calendar_account."accountId")), ''),
          calendar_account."oauthCredentialId"::text,
          calendar_account."caldavCredentialId"::text,
          calendar_account."id"::text
        )
      ORDER BY calendar_account."updatedAt" DESC, calendar_account."createdAt" DESC, calendar_account."id" DESC
    ) AS "newAccountId"
  FROM "calendar_accounts" calendar_account
)
SELECT "oldAccountId", "newAccountId"
FROM ranked_calendar_accounts
WHERE "oldAccountId" <> "newAccountId";
--> statement-breakpoint
UPDATE "calendar_accounts" canonical
SET
  "accountId" = COALESCE(canonical."accountId", duplicate."accountId"),
  "email" = COALESCE(canonical."email", duplicate."email"),
  "displayName" = COALESCE(canonical."displayName", duplicate."displayName"),
  "oauthCredentialId" = COALESCE(canonical."oauthCredentialId", duplicate."oauthCredentialId"),
  "caldavCredentialId" = COALESCE(canonical."caldavCredentialId", duplicate."caldavCredentialId"),
  "needsReauthentication" = canonical."needsReauthentication" OR duplicate."needsReauthentication",
  "createdAt" = LEAST(canonical."createdAt", duplicate."createdAt"),
  "updatedAt" = GREATEST(canonical."updatedAt", duplicate."updatedAt")
FROM "tmp_calendar_account_id_map_0040" id_map
JOIN "calendar_accounts" duplicate ON duplicate."id" = id_map."oldAccountId"
WHERE canonical."id" = id_map."newAccountId";
--> statement-breakpoint
UPDATE "calendars" calendar
SET "accountId" = id_map."newAccountId"
FROM "tmp_calendar_account_id_map_0040" id_map
WHERE calendar."accountId" = id_map."oldAccountId";
--> statement-breakpoint
DELETE FROM "calendar_accounts" duplicate_account
USING "tmp_calendar_account_id_map_0040" id_map
WHERE duplicate_account."id" = id_map."oldAccountId";
