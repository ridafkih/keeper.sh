import useSWRSubscription from "swr/subscription";
import { mutate } from "swr";
import { socketMessageSchema, syncStatusSchema, type SyncStatus } from "@keeper.sh/data-schemas";

const fetchSocketUrl = async (): Promise<string> => {
  const response = await fetch("/api/socket/url");
  if (!response.ok) throw new Error("Failed to fetch socket URL");
  const { socketUrl, socketPath } = await response.json();

  if (socketUrl) return socketUrl;

  const url = new URL(socketPath, window.location.origin);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

type SyncStatusRecord = Record<string, SyncStatus>;
type Next = (error?: Error | null, data?: SyncStatusRecord) => void;

export function useSyncStatus() {
  return useSWRSubscription("sync-status", (_, { next }: { next: Next }) => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let statuses: SyncStatusRecord = {};
    let isClosing = false;

    const connect = async () => {
      if (isClosing) return;

      try {
        const socketUrl = await fetchSocketUrl();
        if (isClosing) return;

        socket = new WebSocket(socketUrl);

        socket.onmessage = (messageEvent) => {
          const message = JSON.parse(String(messageEvent.data));

          if (!socketMessageSchema.allows(message)) {
            next(new Error("Invalid socket message format"));
            return;
          }

          if (message.event === "ping") {
            socket?.send(JSON.stringify({ event: "pong" }));
            return;
          }

          if (message.event !== "sync:status") return;

          if (!syncStatusSchema.allows(message.data)) {
            next(new Error("Invalid sync status data"));
            return;
          }

          if (message.data.needsReauthentication) {
            mutate("linked-accounts");
          }

          statuses = { ...statuses, [message.data.destinationId]: message.data };
          next(null, statuses);
        };

        socket.onclose = () => {
          if (isClosing) return;
          reconnectTimer = setTimeout(connect, 3000);
        };

        socket.onerror = () => {
          next(new Error("WebSocket error"));
        };
      } catch {
        if (isClosing) return;
        reconnectTimer = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      isClosing = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  });
}
