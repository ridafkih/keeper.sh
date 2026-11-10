import { z } from "zod";
import {
  AGENT_FEEDBACK_CATEGORIES,
  AGENT_FEEDBACK_SEVERITIES,
  AGENT_FEEDBACK_TOOL_NAME_PATTERN,
  AGENT_FEEDBACK_USER_AGENT_PREFIX,
  DEFAULT_AGENT_FEEDBACK_SEVERITY,
  MAX_AGENT_FEEDBACK_MESSAGE_LENGTH,
} from "@keeper.sh/data-schemas";
import type { AgentFeedbackDeployment } from "@keeper.sh/data-schemas";
import { ADDITIVE, pickProvided, requireString } from "../tool-api";
import type { KeeperMcpToolDefinition, KeeperToolCall } from "../tool-api";
import { widelog } from "../utils/logging";

const AGENT_FEEDBACK_URL = "https://www.keeper.sh/api/v1/agent-feedback";

const FEEDBACK_DELIVERY_TIMEOUT_MS = 5000;

const FEEDBACK_SENT = "Thanks, the Keeper.sh team received your feedback. Carry on with your task.";
const FEEDBACK_NOT_SENT = "Your feedback could not be delivered right now. Carry on with your task.";

const SEND_FEEDBACK_ANNOTATIONS = { ...ADDITIVE, openWorldHint: true };

interface KeeperFeedbackOptions {
  version: string;
  deployment: AgentFeedbackDeployment;
}

interface KeeperFeedbackToolset {
  send_feedback: KeeperMcpToolDefinition<string>;
}

const resolveDeployment = (commercialMode: boolean): AgentFeedbackDeployment => {
  if (commercialMode) {
    return "hosted";
  }
  return "self-hosted";
};

const buildFeedbackBody = (
  { version, deployment }: KeeperFeedbackOptions,
  input: Record<string, unknown> | undefined,
  call: KeeperToolCall | undefined,
): string =>
  JSON.stringify({
    message: requireString(input, "message"),
    category: requireString(input, "category"),
    severity: input?.severity ?? DEFAULT_AGENT_FEEDBACK_SEVERITY,
    ...pickProvided(input, ["toolName"]),
    ...(call?.intent && { intent: call.intent }),
    version,
    deployment,
  });

const deliverFeedback = async (version: string, body: string): Promise<boolean> => {
  const response = await fetch(AGENT_FEEDBACK_URL, {
    body,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": `${AGENT_FEEDBACK_USER_AGENT_PREFIX}${version}`,
    },
    method: "POST",
    signal: AbortSignal.timeout(FEEDBACK_DELIVERY_TIMEOUT_MS),
  });
  widelog.set("mcp.feedback.status_code", response.status);
  return response.ok;
};

const createFeedbackToolset = (options: KeeperFeedbackOptions): KeeperFeedbackToolset => ({
  send_feedback: {
    title: "Send feedback to Keeper.sh",
    annotations: SEND_FEEDBACK_ANNOTATIONS,
    description:
      "Send feedback about Keeper.sh's MCP tools and API to the Keeper.sh team. Call it when you hit a problem yourself: an unexpected error or confusing result, a capability you needed that is missing, unclear documentation, or a workaround you had to use. Never include the user's calendar data or personal details.",
    inputSchema: {
      message: z
        .string()
        .trim()
        .min(1)
        .max(MAX_AGENT_FEEDBACK_MESSAGE_LENGTH)
        .describe("Your goal, what you tried, and where you got stuck. No event details, names, emails or other user data"),
      category: z
        .enum(AGENT_FEEDBACK_CATEGORIES)
        .describe("What kind of problem it is"),
      toolName: z
        .string()
        .regex(AGENT_FEEDBACK_TOOL_NAME_PATTERN)
        .optional()
        .describe("The Keeper.sh tool the feedback is about, if any"),
      severity: z
        .enum(AGENT_FEEDBACK_SEVERITIES)
        .optional()
        .describe("high if it blocked you, medium if you found a workaround, low for an annoyance. Defaults to medium"),
    },
    execute: async (_context, input, call) => {
      const body = buildFeedbackBody(options, input, call);
      const delivered = await deliverFeedback(options.version, body).catch((error: unknown) => {
        widelog.set("mcp.feedback.error", String(error));
        return false;
      });
      widelog.set("mcp.feedback.delivered", delivered);
      if (delivered) {
        return FEEDBACK_SENT;
      }
      return FEEDBACK_NOT_SENT;
    },
  },
});

export { AGENT_FEEDBACK_URL, createFeedbackToolset, resolveDeployment };
export type { KeeperFeedbackOptions, KeeperFeedbackToolset };
