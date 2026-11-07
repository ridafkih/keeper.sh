import { isJSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";
import { listPayloadMessages } from "./discovery";

const OPENAI_USER_AGENT_PATTERN = /chatgpt|openai/i;
const OPENAI_REQUEST_META_PREFIX = "openai/";

const hasOpenAiRequestMeta = (message: unknown): boolean => {
  if (!isJSONRPCRequest(message)) {
    return false;
  }

  const meta = message.params?._meta;

  if (!meta) {
    return false;
  }

  return Object.keys(meta).some((key) => key.startsWith(OPENAI_REQUEST_META_PREFIX));
};

const expectsToolResultSignIn = (request: Request, payload: unknown): boolean =>
  OPENAI_USER_AGENT_PATTERN.test(request.headers.get("user-agent") ?? "")
  || listPayloadMessages(payload).some((message) => hasOpenAiRequestMeta(message));

export { expectsToolResultSignIn };
