import { vi } from "vitest";
import type { KeeperToolContext } from "../../src/tool-api";

const context: KeeperToolContext = {
  apiBaseUrl: "https://api.test",
  bearerToken: "token-123",
};

interface CapturedRequest {
  url: string;
  method: string | null;
  body: unknown;
}

const readBody = (body: RequestInit["body"]): unknown => {
  if (typeof body === "string") {
    return JSON.parse(body);
  }
  return null;
};

const stubApi = (payload: unknown, status = 200): CapturedRequest[] => {
  const requests: CapturedRequest[] = [];

  vi.stubGlobal("fetch", (url: string, options?: RequestInit) => {
    requests.push({
      body: readBody(options?.body),
      method: options?.method ?? null,
      url,
    });
    if (status === 204) {
      return Promise.resolve(new Response(null, { status }));
    }
    return Promise.resolve(Response.json(payload, { status }));
  });

  return requests;
};

const MISSING_WRITE_SCOPE = { error: "This token is missing the keeper.write scope." };
const DAILY_CAP_REACHED = { error: "Daily API limit exceeded. Upgrade to Pro for unlimited access." };

export { DAILY_CAP_REACHED, MISSING_WRITE_SCOPE, context, stubApi };
export type { CapturedRequest };
