import { isJSONRPCNotification, isJSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";

const DISCOVERY_METHODS: ReadonlySet<string> = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
]);

const isDiscoveryMessage = (message: unknown): boolean =>
  (isJSONRPCRequest(message) || isJSONRPCNotification(message))
  && DISCOVERY_METHODS.has(message.method);

const isDiscoveryPayload = (payload: unknown): boolean => {
  if (Array.isArray(payload)) {
    return payload.length > 0 && payload.every((message) => isDiscoveryMessage(message));
  }

  return isDiscoveryMessage(payload);
};

export { DISCOVERY_METHODS, isDiscoveryPayload };
