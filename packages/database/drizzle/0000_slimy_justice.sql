CREATE TABLE "calendar_snapshots" (
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"ical" text
);
