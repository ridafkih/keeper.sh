import { isJSONRPCNotification, isJSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";

const DISCOVERY_METHODS: ReadonlySet<string> = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
]);

const SIGN_IN_PROMPTING_METHODS: ReadonlySet<string> = new Set([
  ...DISCOVERY_METHODS,
  "tools/call",
]);

const listPayloadMessages = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) {
    return payload;
  }

  return [payload];
};

const isMessageWithin = (methods: ReadonlySet<string>, message: unknown): boolean =>
  (isJSONRPCRequest(message) || isJSONRPCNotification(message))
  && methods.has(message.method);

const isPayloadWithin = (methods: ReadonlySet<string>, payload: unknown): boolean => {
  const messages = listPayloadMessages(payload);
  return messages.length > 0 && messages.every((message) => isMessageWithin(methods, message));
};

const isDiscoveryPayload = (payload: unknown): boolean =>
  isPayloadWithin(DISCOVERY_METHODS, payload);

const isSignInPromptingPayload = (payload: unknown): boolean =>
  isPayloadWithin(SIGN_IN_PROMPTING_METHODS, payload);

export { isDiscoveryPayload, isSignInPromptingPayload, listPayloadMessages };
