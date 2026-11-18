import {
  AGENT_FEEDBACK_USER_AGENT_PREFIX,
  MAX_AGENT_FEEDBACK_BODY_BYTES,
  agentFeedbackRequestSchema,
} from "@keeper.sh/data-schemas";
import type { AgentFeedbackRequest } from "@keeper.sh/data-schemas";
import { agentFeedbackTable } from "@keeper.sh/database/schema";
import { type } from "arktype";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import { database, resend, feedbackEmail } from "@/context";

const AGENT_FEEDBACK_TEMPLATE_ID = "agent-feedback";
const AGENT_FEEDBACK_SUBJECT_PREFIX = "Agent feedback:";
const NOT_PROVIDED = "none";

const isJsonRequest = (request: Request): boolean =>
  request.headers.get("content-type")?.toLowerCase().startsWith("application/json") ?? false;

const isKeeperMcpClient = (request: Request): boolean =>
  request.headers.get("user-agent")?.startsWith(AGENT_FEEDBACK_USER_AGENT_PREFIX) ?? false;

const declaresOversizedBody = (request: Request): boolean =>
  Number(request.headers.get("content-length") ?? 0) > MAX_AGENT_FEEDBACK_BODY_BYTES;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const describeSubject = ({ category, severity, toolName }: AgentFeedbackRequest): string => {
  const subject = `${AGENT_FEEDBACK_SUBJECT_PREFIX} ${category} (${severity})`;
  if (toolName) {
    return `${subject} on ${toolName}`;
  }
  return subject;
};

const notifyTeam = async (feedback: AgentFeedbackRequest): Promise<boolean> => {
  if (!resend || !feedbackEmail) {
    return false;
  }

  const { error } = await resend.emails.send({
    subject: describeSubject(feedback),
    template: {
      id: AGENT_FEEDBACK_TEMPLATE_ID,
      variables: {
        category: feedback.category,
        deployment: feedback.deployment,
        intent: feedback.intent ?? NOT_PROVIDED,
        message: feedback.message,
        severity: feedback.severity,
        toolName: feedback.toolName ?? NOT_PROVIDED,
        version: feedback.version,
      },
    },
    to: feedbackEmail,
  });

  return error === null;
};

const rejectShape = (reason: string): Response => {
  widelog.set("agent_feedback.rejected", reason);
  return ErrorResponse.badRequest("Invalid agent feedback request.").toResponse();
};

const rejectOversized = (): Response => {
  widelog.set("agent_feedback.rejected", "size");
  return ErrorResponse.payloadTooLarge("Agent feedback is too large.").toResponse();
};

const POST = withWideEvent(async ({ request }) => {
  if (!isKeeperMcpClient(request)) {
    return rejectShape("client");
  }
  if (!isJsonRequest(request)) {
    return rejectShape("content_type");
  }
  if (declaresOversizedBody(request)) {
    return rejectOversized();
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_AGENT_FEEDBACK_BODY_BYTES) {
    return rejectOversized();
  }

  const feedback = agentFeedbackRequestSchema(parseJson(text));
  if (feedback instanceof type.errors) {
    return rejectShape("body");
  }

  await database.insert(agentFeedbackTable).values(feedback);

  widelog.set("agent_feedback.category", feedback.category);
  widelog.set("agent_feedback.severity", feedback.severity);
  widelog.set("agent_feedback.deployment", feedback.deployment);
  widelog.set("agent_feedback.version", feedback.version);
  if (feedback.toolName) {
    widelog.set("agent_feedback.tool_name", feedback.toolName);
  }

  const notified = await notifyTeam(feedback).catch((error: unknown) => {
    widelog.set("agent_feedback.notify_error", String(error));
    return false;
  });
  widelog.set("agent_feedback.notified", notified);

  return Response.json({ received: true }, { status: HTTP_STATUS.CREATED });
});

export { POST };
