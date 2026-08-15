-- A second statement shipped here and ran in production, where it matched no rows.
-- It copied a sibling row's "accountId" onto a row holding NULL, which always produces
-- two rows sharing ("provider", "accountId") and violates the unique index in both its
-- pre-0086 and post-0086 form. It could only ever match nothing or abort the migration,
-- so it was removed rather than left to break databases that had not yet applied 0085.
-- Adopting a provider account id onto an existing row is handled by adoptProviderAccountId.
UPDATE "calendar_accounts"
SET "accountId" = NULL
WHERE "accountId" = '';
