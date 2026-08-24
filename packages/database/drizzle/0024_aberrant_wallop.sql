CREATE TABLE "event_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eventStateId" uuid NOT NULL,
	"destinationId" uuid NOT NULL,
	"destinationEventUid" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "sourceEventUid" text;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD CONSTRAINT "event_mappings_eventStateId_event_states_id_fk" FOREIGN KEY ("eventStateId") REFERENCES "public"."event_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_mappings" ADD CONSTRAINT "event_mappings_destinationId_calendar_destinations_id_fk" FOREIGN KEY ("destinationId") REFERENCES "public"."calendar_destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_mappings_event_dest_idx" ON "event_mappings" USING btree ("eventStateId","destinationId");--> statement-breakpoint
CREATE INDEX "event_mappings_destination_idx" ON "event_mappings" USING btree ("destinationId");--> statement-breakpoint
CREATE UNIQUE INDEX "event_states_identity_idx" ON "event_states" USING btree ("sourceId","sourceEventUid","startTime","endTime");