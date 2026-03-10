import type { Server as BunServer, ServerWebSocket as BunServerWebSocket } from "bun";
import type { ViteAssets } from "../lib/router-context";

export interface Runtime {
  handleAssetRequest: (request: Request) => Promise<Response>;
  resolveViteAssets: (requestPath: string) => Promise<ViteAssets>;
  renderApp: (request: Request, viteAssets: ViteAssets) => Promise<Response>;
  shutdown?: () => Promise<void>;
}

export interface ServerConfig {
  apiProxyOrigin: string;
  environment: "development" | "production" | "test";
  isProduction: boolean;
  serverPort: number;
  vitePort: number;
}

export interface SocketProxyData {
  targetUrl: string;
  upstreamSocket: WebSocket | null;
}

export type SocketServer = BunServer<SocketProxyData>;
export type SocketConnection = BunServerWebSocket<SocketProxyData>;
