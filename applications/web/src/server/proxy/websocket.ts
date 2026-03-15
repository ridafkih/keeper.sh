import type { SocketConnection, SocketProxyData, SocketServer } from "../types";
import type { ServerConfig } from "../types";
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

    upstreamSocket.close(code, reason);
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
        clientSocket.close(event.code, event.reason);
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
