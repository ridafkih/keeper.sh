CREATE TABLE IF NOT EXISTS "agent_feedback" (
	"category" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deployment" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent" text,
	"message" text NOT NULL,
	"severity" text NOT NULL,
	"toolName" text,
	"version" text NOT NULL,
	CONSTRAINT "agent_feedback_category_check" CHECK ("category" IN ('tool_error', 'missing_capability', 'confusing_output', 'documentation', 'other')),
	CONSTRAINT "agent_feedback_severity_check" CHECK ("severity" IN ('high', 'medium', 'low')),
	CONSTRAINT "agent_feedback_deployment_check" CHECK ("deployment" IN ('hosted', 'self-hosted'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_feedback_created_at_idx" ON "agent_feedback" USING btree ("createdAt");