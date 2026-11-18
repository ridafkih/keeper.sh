CREATE TABLE IF NOT EXISTS "user_sign_up_attributions" (
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"landingPath" text,
	"referrerOrigin" text,
	"userId" text PRIMARY KEY NOT NULL,
	"utmCampaign" text,
	"utmMedium" text,
	"utmSource" text
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_sign_up_attributions_userId_user_id_fk' AND conrelid = 'user_sign_up_attributions'::regclass) THEN
    ALTER TABLE "user_sign_up_attributions" ADD CONSTRAINT "user_sign_up_attributions_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
