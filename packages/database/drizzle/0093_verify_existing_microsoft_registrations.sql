UPDATE "user" SET "emailVerified" = true WHERE "emailVerified" = false AND EXISTS (
  SELECT 1 FROM "account"
  WHERE "account"."userId" = "user"."id" AND "account"."providerId" = 'microsoft'
);
