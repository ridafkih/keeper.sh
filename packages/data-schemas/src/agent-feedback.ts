import { type } from "arktype";

const AGENT_FEEDBACK_CATEGORIES = [
  "tool_error",
  "missing_capability",
  "confusing_output",
  "documentation",
  "other",
] as const;

const AGENT_FEEDBACK_SEVERITIES = ["high", "medium", "low"] as const;

const DEFAULT_AGENT_FEEDBACK_SEVERITY = "medium" as const;

const AGENT_FEEDBACK_DEPLOYMENTS = ["hosted", "self-hosted"] as const;

const MAX_AGENT_FEEDBACK_MESSAGE_LENGTH = 2000;

const MAX_AGENT_INTENT_LENGTH = 300;

const MAX_AGENT_FEEDBACK_BODY_BYTES = 8192;

const AGENT_FEEDBACK_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

const AGENT_FEEDBACK_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;

const AGENT_FEEDBACK_USER_AGENT_PREFIX = "keeper-mcp/";

const agentFeedbackCategorySchema = type.enumerated(...AGENT_FEEDBACK_CATEGORIES);
type AgentFeedbackCategory = typeof agentFeedbackCategorySchema.infer;

const agentFeedbackSeveritySchema = type.enumerated(...AGENT_FEEDBACK_SEVERITIES);
type AgentFeedbackSeverity = typeof agentFeedbackSeveritySchema.infer;

const agentFeedbackDeploymentSchema = type.enumerated(...AGENT_FEEDBACK_DEPLOYMENTS);
type AgentFeedbackDeployment = typeof agentFeedbackDeploymentSchema.infer;

const agentFeedbackMessageSchema = type("string.trim").to(
  `0 < string <= ${MAX_AGENT_FEEDBACK_MESSAGE_LENGTH}`,
);

const agentIntentSchema = type("string.trim").to(`0 < string <= ${MAX_AGENT_INTENT_LENGTH}`);

const agentFeedbackRequestSchema = type({
  message: agentFeedbackMessageSchema,
  category: agentFeedbackCategorySchema,
  severity: agentFeedbackSeveritySchema,
  "toolName?": AGENT_FEEDBACK_TOOL_NAME_PATTERN,
  "intent?": agentIntentSchema,
  version: AGENT_FEEDBACK_VERSION_PATTERN,
  deployment: agentFeedbackDeploymentSchema,
  "+": "reject",
});
type AgentFeedbackRequest = typeof agentFeedbackRequestSchema.inferOut;

export {
  AGENT_FEEDBACK_CATEGORIES,
  AGENT_FEEDBACK_DEPLOYMENTS,
  AGENT_FEEDBACK_SEVERITIES,
  AGENT_FEEDBACK_TOOL_NAME_PATTERN,
  AGENT_FEEDBACK_USER_AGENT_PREFIX,
  AGENT_FEEDBACK_VERSION_PATTERN,
  DEFAULT_AGENT_FEEDBACK_SEVERITY,
  MAX_AGENT_FEEDBACK_BODY_BYTES,
  MAX_AGENT_FEEDBACK_MESSAGE_LENGTH,
  MAX_AGENT_INTENT_LENGTH,
  agentFeedbackCategorySchema,
  agentFeedbackDeploymentSchema,
  agentFeedbackRequestSchema,
  agentFeedbackSeveritySchema,
};
export type {
  AgentFeedbackCategory,
  AgentFeedbackDeployment,
  AgentFeedbackRequest,
  AgentFeedbackSeverity,
};
