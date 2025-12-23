CREATE TABLE "user_ical_tokens" (
	"userId" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_ical_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "user_ical_tokens" ADD CONSTRAINT "user_ical_tokens_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;