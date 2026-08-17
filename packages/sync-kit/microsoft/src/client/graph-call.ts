import type { Client, GraphRequest } from "@microsoft/microsoft-graph-client";
import { ResponseType } from "@microsoft/microsoft-graph-client";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { HeldResponse } from "./raw-response";
import { discardResponse, holdResponse } from "./raw-response";

const graphMethods = ["get", "post", "patch", "delete"] as const;
type GraphMethod = (typeof graphMethods)[number];

interface GraphCall {
  readonly method: GraphMethod;
  readonly path: string;
  readonly search?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

class GraphResponseFailure extends Error {
  readonly status: number;

  readonly code: string | null;

  readonly headers: Headers;

  constructor(held: HeldResponse, code: string | null) {
    super(`Graph answered ${held.status}`);
    this.name = "GraphResponseFailure";
    this.status = held.status;
    this.code = code;
    this.headers = held.headers;
  }
}

const readProperty = (value: unknown, name: string): unknown => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return Reflect.get(value, name);
};

const codeOfBody = (held: HeldResponse): string | null => {
  if (held.body.kind !== "json") {
    return null;
  }
  const code = readProperty(readProperty(held.body.value, "error"), "code");
  if (typeof code !== "string" || code.length === 0) {
    return null;
  }
  return code;
};

const requestFor = (client: Client, call: GraphCall, signal: AbortSignal): GraphRequest => {
  const request = client.api(call.path).responseType(ResponseType.RAW).options({ signal });
  if (call.search) {
    request.query({ ...call.search });
  }
  if (call.headers) {
    request.headers({ ...call.headers });
  }
  return request;
};

const dispatch = (request: GraphRequest, call: GraphCall): Promise<Response> => {
  switch (call.method) {
    case "get": {
      return request.get();
    }
    case "post": {
      return request.post(call.body);
    }
    case "patch": {
      return request.patch(call.body);
    }
    case "delete": {
      return request.delete();
    }
    default: {
      return assertNever(call.method);
    }
  }
};

const failureOf = async (response: Response): Promise<GraphResponseFailure> => {
  const held = await holdResponse(response);
  return new GraphResponseFailure(held, codeOfBody(held));
};

const graphJson = async (
  client: Client,
  call: GraphCall,
  signal: AbortSignal,
): Promise<unknown> => {
  const response: Response = await dispatch(requestFor(client, call, signal), call);
  if (!response.ok) {
    throw await failureOf(response);
  }
  const held = await holdResponse(response);
  if (held.body.kind === "json") {
    return held.body.value;
  }
  return null;
};

const graphEmpty = async (
  client: Client,
  call: GraphCall,
  signal: AbortSignal,
): Promise<null> => {
  const response: Response = await dispatch(requestFor(client, call, signal), call);
  if (!response.ok) {
    throw await failureOf(response);
  }
  await discardResponse(response);
  return null;
};

export { graphEmpty, graphJson, graphMethods, GraphResponseFailure };
export type { GraphCall, GraphMethod };
