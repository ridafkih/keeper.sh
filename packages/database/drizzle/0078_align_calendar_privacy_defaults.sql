ALTER TABLE "calendars" ALTER COLUMN "excludeEventDescription" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "excludeEventLocation" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "excludeEventName" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "calendars" ALTER COLUMN "customEventName" SET DEFAULT '{{calendar_name}}';