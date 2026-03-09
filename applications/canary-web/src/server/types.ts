import type { Server as BunServer, ServerWebSocket as BunServerWebSocket } from "bun";

export interface Runtime {
  handleAssetRequest: (request: Request) => Promise<Response>;
  renderApp: (request: Request) => Promise<Response>;
  renderTemplate: (requestPath: string) => Promise<string>;
  shutdown?: () => Promise<void>;
}

export interface ServerConfig {
  apiProxyOrigin: string;
  environment: "development" | "production" | "test";
  isProduction: boolean;
  serverPort: number;
  vitePort: number;
}

export interface TemplateSegments {
  prefix: string;
  suffix: string;
}

export interface SocketProxyData {
  targetUrl: string;
  upstreamSocket: WebSocket | null;
}

export type SocketServer = BunServer<SocketProxyData>;
export type SocketConnection = BunServerWebSocket<SocketProxyData>;
