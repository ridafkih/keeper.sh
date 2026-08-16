-- Every value here is UTC wall clock: the application writes UTC, and the columns
-- carrying DEFAULT now() were written by a server whose time zone the migration runner
-- asserts is UTC before it gets here. The ALTERs are deliberately bare — with the
-- session in UTC the conversion is binary-identical, so Postgres records it as metadata
-- and skips the rewrite. Adding USING would force a full rewrite of every table under
-- ACCESS EXCLUSIVE, and would still be wrong for the defaulted columns on a server
-- whose zone was never UTC.
ALTER TABLE "account" ALTER COLUMN "accessTokenExpiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "refreshTokenExpiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "jwks" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jwks" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "jwks" ALTER COLUMN "expiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ALTER COLUMN "expiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "oauth_application" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_application" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "oauth_application" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_application" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "oauth_application" ALTER COLUMN "expiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_consent" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_consent" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "oauth_consent" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_consent" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ALTER COLUMN "expiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ALTER COLUMN "revoked" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ALTER COLUMN "authTime" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "passkey" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "expiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "expiresAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "updatedAt" SET DEFAULT now();