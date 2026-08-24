ALTER TABLE "calendars" ADD COLUMN "excludeEventDescription" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "excludeEventLocation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "excludeEventName" boolean DEFAULT false NOT NULL;