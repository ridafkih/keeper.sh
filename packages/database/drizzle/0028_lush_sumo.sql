CREATE TABLE "source_destination_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sourceId" uuid NOT NULL,
	"destinationId" uuid NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD CONSTRAINT "source_destination_mappings_sourceId_remote_ical_sources_id_fk" FOREIGN KEY ("sourceId") REFERENCES "public"."remote_ical_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_destination_mappings" ADD CONSTRAINT "source_destination_mappings_destinationId_calendar_destinations_id_fk" FOREIGN KEY ("destinationId") REFERENCES "public"."calendar_destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_destination_mapping_idx" ON "source_destination_mappings" USING btree ("sourceId","destinationId");--> statement-breakpoint
CREATE INDEX "source_destination_mappings_source_idx" ON "source_destination_mappings" USING btree ("sourceId");--> statement-breakpoint
CREATE INDEX "source_destination_mappings_destination_idx" ON "source_destination_mappings" USING btree ("destinationId");--> statement-breakpoint
INSERT INTO "source_destination_mappings" ("sourceId", "destinationId")
SELECT sources.id, destinations.id
FROM "remote_ical_sources" sources
INNER JOIN "calendar_destinations" destinations ON sources."userId" = destinations."userId"
ON CONFLICT DO NOTHING;