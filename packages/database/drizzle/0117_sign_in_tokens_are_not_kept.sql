CREATE OR REPLACE FUNCTION "account_discard_sign_in_tokens"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."accessToken" := NULL;
  NEW."accessTokenExpiresAt" := NULL;
  NEW."idToken" := NULL;
  NEW."refreshToken" := NULL;
  NEW."refreshTokenExpiresAt" := NULL;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "account_discard_sign_in_tokens" ON "account";
--> statement-breakpoint
CREATE TRIGGER "account_discard_sign_in_tokens"
BEFORE INSERT OR UPDATE ON "account"
FOR EACH ROW
WHEN (
  NEW."accessToken" IS NOT NULL
  OR NEW."accessTokenExpiresAt" IS NOT NULL
  OR NEW."idToken" IS NOT NULL
  OR NEW."refreshToken" IS NOT NULL
  OR NEW."refreshTokenExpiresAt" IS NOT NULL
)
EXECUTE FUNCTION "account_discard_sign_in_tokens"();
--> statement-breakpoint
UPDATE "account"
SET
  "accessToken" = NULL,
  "accessTokenExpiresAt" = NULL,
  "idToken" = NULL,
  "refreshToken" = NULL,
  "refreshTokenExpiresAt" = NULL
WHERE "accessToken" IS NOT NULL
  OR "accessTokenExpiresAt" IS NOT NULL
  OR "idToken" IS NOT NULL
  OR "refreshToken" IS NOT NULL
  OR "refreshTokenExpiresAt" IS NOT NULL;
