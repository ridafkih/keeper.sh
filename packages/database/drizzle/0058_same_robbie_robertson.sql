CREATE TABLE "oauth_access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"clientId" text NOT NULL,
	"sessionId" text,
	"userId" text,
	"referenceId" text,
	"refreshId" text,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauth_access_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauth_application" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"clientSecret" text,
	"disabled" boolean DEFAULT false NOT NULL,
	"skipConsent" boolean,
	"enableEndSession" boolean,
	"subjectType" text,
	"scopes" text[],
	"userId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"softwareId" text,
	"softwareVersion" text,
	"softwareStatement" text,
	"redirectUris" text[] NOT NULL,
	"postLogoutRedirectUris" text[],
	"tokenEndpointAuthMethod" text,
	"grantTypes" text[],
	"responseTypes" text[],
	"public" boolean,
	"type" text,
	"requirePKCE" boolean,
	"referenceId" text,
	"metadata" text,
	CONSTRAINT "oauth_application_clientId_unique" UNIQUE("clientId")
);
--> statement-breakpoint
CREATE TABLE "oauth_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"userId" text NOT NULL,
	"referenceId" text,
	"scopes" text[] NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"clientId" text NOT NULL,
	"sessionId" text,
	"userId" text NOT NULL,
	"referenceId" text,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"revoked" timestamp,
	"authTime" timestamp,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauth_refresh_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_clientId_oauth_application_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauth_application"("clientId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_sessionId_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_refreshId_oauth_refresh_token_id_fk" FOREIGN KEY ("refreshId") REFERENCES "public"."oauth_refresh_token"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_application" ADD CONSTRAINT "oauth_application_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_clientId_oauth_application_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauth_application"("clientId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_clientId_oauth_application_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauth_application"("clientId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_sessionId_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_access_token_client_idx" ON "oauth_access_token" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "oauth_access_token_session_idx" ON "oauth_access_token" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "oauth_access_token_user_idx" ON "oauth_access_token" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "oauth_access_token_refresh_idx" ON "oauth_access_token" USING btree ("refreshId");--> statement-breakpoint
CREATE INDEX "oauth_application_user_idx" ON "oauth_application" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "oauth_consent_client_idx" ON "oauth_consent" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "oauth_consent_user_idx" ON "oauth_consent" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "oauth_consent_reference_idx" ON "oauth_consent" USING btree ("referenceId");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_client_idx" ON "oauth_refresh_token" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_session_idx" ON "oauth_refresh_token" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_user_idx" ON "oauth_refresh_token" USING btree ("userId");