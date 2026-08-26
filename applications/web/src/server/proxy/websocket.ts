import type { SocketConnection, SocketProxyData, SocketServer } from "@/server/types";
import type { ServerConfig } from "@/server/types";
import { toProxiedUrl } from "./http";

function isSocketProxyPath(url: URL): boolean {
  return url.pathname === "/api/socket";
}

function isWebSocketUpgradeRequest(request: Request): boolean {
  const upgradeHeader = request.headers.get("upgrade");
  return upgradeHeader?.toLowerCase() === "websocket";
}

function toWebSocketUrl(requestUrl: URL, origin: string): string {
  const upstreamUrl = toProxiedUrl(requestUrl, origin);

  if (upstreamUrl.protocol === "http:") {
    upstreamUrl.protocol = "ws:";
    return upstreamUrl.toString();
  }

  if (upstreamUrl.protocol === "https:") {
    upstreamUrl.protocol = "wss:";
    return upstreamUrl.toString();
  }

  throw new Error("API proxy origin must use http or https.");
}

const NORMAL_CLOSURE = 1000;
const LOWEST_PROTOCOL_CODE = 1000;
const HIGHEST_PROTOCOL_CODE = 1014;
const LOWEST_RESERVED_CODE = 1004;
const HIGHEST_RESERVED_CODE = 1006;
const LOWEST_APPLICATION_CODE = 3000;
const HIGHEST_APPLICATION_CODE = 4999;

export function toForwardableCloseCode(code: number | undefined): number {
  if (code === undefined) {
    return NORMAL_CLOSURE;
  }

  if (code >= LOWEST_RESERVED_CODE && code <= HIGHEST_RESERVED_CODE) {
    return NORMAL_CLOSURE;
  }

  if (code >= LOWEST_PROTOCOL_CODE && code <= HIGHEST_PROTOCOL_CODE) {
    return code;
  }

  if (code >= LOWEST_APPLICATION_CODE && code <= HIGHEST_APPLICATION_CODE) {
    return code;
  }

  return NORMAL_CLOSURE;
}

function relayUpstreamMessageToClient(clientSocket: SocketConnection, message: unknown): void {
  if (typeof message === "string") {
    clientSocket.send(message);
    return;
  }

  if (message instanceof ArrayBuffer) {
    clientSocket.send(new Uint8Array(message));
    return;
  }

  if (ArrayBuffer.isView(message)) {
    const typedArray = new Uint8Array(
      message.buffer,
      message.byteOffset,
      message.byteLength,
    );
    const chunkCopy = new Uint8Array(typedArray.byteLength);
    chunkCopy.set(typedArray);
    clientSocket.send(chunkCopy);
  }
}

function relayClientMessageToUpstream(upstreamSocket: WebSocket, message: unknown): void {
  if (typeof message === "string") {
    upstreamSocket.send(message);
    return;
  }

  if (message instanceof ArrayBuffer) {
    upstreamSocket.send(message);
    return;
  }

  if (ArrayBuffer.isView(message)) {
    upstreamSocket.send(message);
  }
}

export function upgradeSocketProxy(
  request: Request,
  server: SocketServer,
  config: ServerConfig,
): boolean {
  const requestUrl = new URL(request.url);
  if (!isSocketProxyPath(requestUrl)) {
    return false;
  }

  if (!isWebSocketUpgradeRequest(request)) {
    return false;
  }

  const targetUrl = toWebSocketUrl(requestUrl, config.apiProxyOrigin);
  return server.upgrade(request, {
    data: {
      targetUrl,
      upstreamSocket: null,
    } satisfies SocketProxyData,
  });
}

export const websocketProxyHandlers = {
  close(clientSocket: SocketConnection, code: number, reason: string): void {
    const upstreamSocket = clientSocket.data.upstreamSocket;
    if (!upstreamSocket) {
      return;
    }

    if (upstreamSocket.readyState === WebSocket.CLOSING) {
      return;
    }

    if (upstreamSocket.readyState === WebSocket.CLOSED) {
      return;
    }

    upstreamSocket.close(toForwardableCloseCode(code), reason);
    clientSocket.data.upstreamSocket = null;
  },
  message(clientSocket: SocketConnection, message: unknown): void {
    const upstreamSocket = clientSocket.data.upstreamSocket;
    if (!upstreamSocket) {
      return;
    }

    if (upstreamSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    relayClientMessageToUpstream(upstreamSocket, message);
  },
  open(clientSocket: SocketConnection): void {
    const upstreamSocket = new WebSocket(clientSocket.data.targetUrl);
    upstreamSocket.binaryType = "arraybuffer";
    clientSocket.data.upstreamSocket = upstreamSocket;

    upstreamSocket.addEventListener("close", (event) => {
      if (clientSocket.readyState === 1) {
        clientSocket.close(toForwardableCloseCode(event.code), event.reason);
      }
    });

    upstreamSocket.addEventListener("error", () => {
      if (clientSocket.readyState === 1) {
        clientSocket.close(1011, "Upstream websocket error");
      }
    });

    upstreamSocket.addEventListener("message", (event) => {
      relayUpstreamMessageToClient(clientSocket, event.data);
    });
  },
};
