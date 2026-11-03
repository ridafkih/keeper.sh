CREATE TABLE "oauth_client_assertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_client_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"resourceId" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "oauth_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"accessTokenTtl" integer,
	"refreshTokenTtl" integer,
	"signingAlgorithm" text,
	"signingKeyId" text,
	"allowedScopes" text[],
	"customClaims" jsonb,
	"dpopBoundAccessTokensRequired" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now(),
	"policyVersion" integer DEFAULT 1,
	"metadata" jsonb,
	CONSTRAINT "oauth_resource_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
ALTER TABLE "jwks" ADD COLUMN "alg" text;--> statement-breakpoint
ALTER TABLE "jwks" ADD COLUMN "crv" text;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN "authorizationCodeId" text;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN "resources" text[];--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN "requestedUserInfoClaims" text[];--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN "revoked" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN "confirmation" jsonb;--> statement-breakpoint
ALTER TABLE "oauth_application" ADD COLUMN "clientDiscoveryId" text;--> statement-breakpoint
ALTER TABLE "oauth_application" ADD COLUMN "clientCredentialsScopes" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "oauth_application" ADD COLUMN "backchannelLogoutUri" text;--> statement-breakpoint
ALTER TABLE "oauth_application" ADD COLUMN "backchannelLogoutSessionRequired" boolean;--> statement-breakpoint
ALTER TABLE "oauth_application" ADD COLUMN "applicationType" text;--> statement-breakpoint
ALTER TABLE "oauth_application" ADD COLUMN "jwks" text;--> statement-breakpoint
ALTER TABLE "oauth_application" ADD COLUMN "jwksUri" text;--> statement-breakpoint
ALTER TABLE "oauth_application" ADD COLUMN "dpopBoundAccessTokens" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD COLUMN "resources" text[];--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD COLUMN "requestedUserInfoClaims" text[];--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "authorizationCodeId" text;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "resources" text[];--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "requestedUserInfoClaims" text[];--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "rotatedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "rotationReplayResponse" text;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "rotationReplayExpiresAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "confirmation" jsonb;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_clientId_oauth_application_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauth_application"("clientId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_resourceId_oauth_resource_identifier_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."oauth_resource"("identifier") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_client_resource_client_resource_idx" ON "oauth_client_resource" USING btree ("clientId","resourceId");--> statement-breakpoint
CREATE INDEX "oauth_client_resource_resource_idx" ON "oauth_client_resource" USING btree ("resourceId");--> statement-breakpoint
CREATE INDEX "oauth_access_token_authorization_code_idx" ON "oauth_access_token" USING btree ("authorizationCodeId");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_authorization_code_idx" ON "oauth_refresh_token" USING btree ("authorizationCodeId");--> statement-breakpoint
UPDATE "oauth_application" SET "applicationType" = "type" WHERE "applicationType" IS NULL AND "type" IN ('web', 'native');
