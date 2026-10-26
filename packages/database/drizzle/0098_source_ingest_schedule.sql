CREATE TABLE "source_ingest_schedule" (
	"calendarId" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"dueAt" timestamp with time zone,
	"failureCount" integer DEFAULT 0 NOT NULL,
	"lastAttemptAt" timestamp with time zone,
	"lastFailureAt" timestamp with time zone,
	"lastSuccessAt" timestamp with time zone,
	"leaseToken" uuid,
	"leasedUntil" timestamp with time zone,
	"parkedReason" text,
	"releaseSeq" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"wakeCorrelationId" text,
	"wakeDueAt" timestamp with time zone,
	"wakeReceivedAt" timestamp with time zone,
	"wakeSeq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "source_ingest_schedule_parked_reason_check" CHECK ("parkedReason" IS NULL OR "parkedReason" IN ('ineligible', 'credential-rejected', 'unresolvable'))
);
--> statement-breakpoint
ALTER TABLE "source_ingest_schedule" ADD CONSTRAINT "source_ingest_schedule_calendarId_calendars_id_fk" FOREIGN KEY ("calendarId") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_ingest_schedule_due_idx" ON "source_ingest_schedule" USING btree ("dueAt") WHERE "source_ingest_schedule"."dueAt" is not null;--> statement-breakpoint
CREATE INDEX "source_ingest_schedule_wake_idx" ON "source_ingest_schedule" USING btree ("wakeDueAt") WHERE "source_ingest_schedule"."wakeDueAt" is not null;