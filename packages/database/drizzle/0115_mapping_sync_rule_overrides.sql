ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "customEventName" text;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "disableEventReminders" boolean;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "excludeAllDayEvents" boolean;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "excludeAvailabilities" text[];--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "excludeEventDescription" boolean;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "excludeEventLocation" boolean;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "excludeEventName" boolean;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "excludeFocusTime" boolean;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "excludeOutOfOffice" boolean;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "excludeTitleKeywords" text[];--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD COLUMN IF NOT EXISTS "markEventsAsPrivate" boolean;