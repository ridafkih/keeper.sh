CREATE TABLE "jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"publicKey" text NOT NULL,
	"privateKey" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp
);
