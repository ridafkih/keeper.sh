import type { Context, Middleware } from "@microsoft/microsoft-graph-client";
import { AuthenticationHandler, Client } from "@microsoft/microsoft-graph-client";
import { createHeldTokenAuthenticationProvider } from "./authentication";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface GraphClientOptions {
  readonly fetch: FetchImplementation;
  readonly getAccessToken: () => Promise<string>;
}

class GraphTransportHandler implements Middleware {
  private readonly send: FetchImplementation;

  constructor(send: FetchImplementation) {
    this.send = send;
  }

  async execute(context: Context): Promise<void> {
    context.response = await this.send(context.request, context.options);
  }
}

const graphVersion = "v1.0";

const graphMiddlewareChain = (options: GraphClientOptions): readonly Middleware[] => [
  new AuthenticationHandler(createHeldTokenAuthenticationProvider(options)),
  new GraphTransportHandler(options.fetch),
];

const createGraphClient = (options: GraphClientOptions): Client =>
  Client.initWithMiddleware({
    middleware: [...graphMiddlewareChain(options)],
    defaultVersion: graphVersion,
  });

export { createGraphClient, graphMiddlewareChain, GraphTransportHandler };
export type { FetchImplementation, GraphClientOptions };
