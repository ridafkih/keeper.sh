DROP INDEX "calendar_destinations_user_provider_account_idx";--> statement-breakpoint
DELETE FROM "calendar_destinations" a USING "calendar_destinations" b
WHERE a.id > b.id
  AND a.provider = b.provider
  AND a."accountId" = b."accountId";--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_destinations_provider_account_idx" ON "calendar_destinations" USING btree ("provider","accountId");