import type { Context, Middleware } from "@microsoft/microsoft-graph-client";
import { Client } from "@microsoft/microsoft-graph-client";
import type { FetchImplementation } from "../../src/client/graph-client";

class TerminalFetchHandler implements Middleware {
  private readonly send: FetchImplementation;

  constructor(send: FetchImplementation) {
    this.send = send;
  }

  async execute(context: Context): Promise<void> {
    const { request } = context;
    context.response = await this.send(request, context.options);
  }
}

const graphClientOver = (send: FetchImplementation): Client =>
  Client.initWithMiddleware({
    middleware: [new TerminalFetchHandler(send)],
    defaultVersion: "v1.0",
  });

export { graphClientOver, TerminalFetchHandler };
