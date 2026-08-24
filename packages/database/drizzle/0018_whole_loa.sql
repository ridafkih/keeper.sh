ALTER TABLE "passkey" ALTER COLUMN "createdAt" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "passkey" ALTER COLUMN "createdAt" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "passkey" ADD COLUMN "aaguid" text;--> statement-breakpoint
ALTER TABLE "passkey" DROP COLUMN "webauthnUserID";