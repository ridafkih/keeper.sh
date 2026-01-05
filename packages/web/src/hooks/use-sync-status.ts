import useSWRSubscription, { type SWRSubscriptionResponse } from "swr/subscription";
import { mutate } from "swr";
import { socketMessageSchema, syncStatusSchema, type SyncStatus } from "@keeper.sh/data-schemas";
import { WEBSOCKET_RECONNECT_DELAY_MS } from "@keeper.sh/constants";

type SyncStatusRecord = Record<string, SyncStatus>;
type Next = (error?: Error | null, data?: SyncStatusRecord) => void;

const buildWebSocketUrl = (socketPath: string): string => {
  const url = new URL(socketPath, globalThis.location.origin);
  url.protocol = ((): string => {
    if (globalThis.location.protocol === "https:") {
      return "wss:";
    }
    return "ws:";
  })();
  return url.toString();
};

const fetchSocketUrl = async (): Promise<string> => {
  const response = await fetch("/api/socket/url");
  if (!response.ok) {
    throw new Error("Failed to fetch socket URL");
  }
  const { socketUrl, socketPath } = await response.json();

  if (socketUrl) {
    return socketUrl;
  }

  return buildWebSocketUrl(socketPath);
};

export const useSyncStatus = (): SWRSubscriptionResponse<SyncStatusRecord, Error> =>
  useSWRSubscription("sync-status", (_key, { next }: { next: Next }): (() => void) => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let statuses: SyncStatusRecord = {};
    let isClosing = false;

    const connect = async (): Promise<void> => {
      if (isClosing) {
        return;
      }

      try {
        const socketUrl = await fetchSocketUrl();
        if (isClosing) {
          return;
        }

        socket = new WebSocket(socketUrl);

        socket.addEventListener("message", (messageEvent) => {
          const message = JSON.parse(String(messageEvent.data));

          if (!socketMessageSchema.allows(message)) {
            next(new Error("Invalid socket message format"));
            return;
          }

          if (message.event === "ping") {
            socket?.send(JSON.stringify({ event: "pong" }));
            return;
          }

          if (message.event !== "sync:status") {
            return;
          }

          if (!syncStatusSchema.allows(message.data)) {
            next(new Error("Invalid sync status data"));
            return;
          }

          if (message.data.needsReauthentication) {
            mutate("linked-accounts");
          }

          statuses = { ...statuses, [message.data.destinationId]: message.data };
          next(null, statuses);
        });

        socket.addEventListener("close", () => {
          if (isClosing) {
            return;
          }
          reconnectTimer = setTimeout(connect, WEBSOCKET_RECONNECT_DELAY_MS);
        });

        socket.addEventListener("error", () => {
          next(new Error("WebSocket error"));
        });
      } catch {
        if (isClosing) {
          return;
        }
        reconnectTimer = setTimeout(connect, WEBSOCKET_RECONNECT_DELAY_MS);
      }
    };

    connect();

    return (): void => {
      isClosing = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  });
