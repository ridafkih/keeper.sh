import { socketMessageSchema } from "@keeper.sh/data-schemas";
import { WEBSOCKET_RECONNECT_DELAY_MS } from "@keeper.sh/constants";

type EventCallback = (data: unknown) => void;

const invokeListeners = (listeners: Set<EventCallback> | undefined, data?: unknown): void => {
  if (!listeners) {
    return;
  }
  for (const callback of listeners) {
    callback(data);
  }
};

export class BroadcastClient {
  private socket: WebSocket | null = null;
  private listeners = new Map<string, Set<EventCallback>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;

  constructor(private url: string) {}

  connect(): void {
    this.shouldReconnect = true;
    this.socket = new WebSocket(this.url);

    this.socket.addEventListener("open", () => {
      invokeListeners(this.listeners.get("$open"));
    });

    this.socket.addEventListener("message", (messageEvent) => {
      const data = JSON.parse(String(messageEvent.data));
      if (!socketMessageSchema.allows(data)) {
        return;
      }

      if (data.event === "ping") {
        this.socket?.send(JSON.stringify({ event: "pong" }));
        return;
      }

      invokeListeners(this.listeners.get(data.event), data.data);
    });

    this.socket.addEventListener("close", () => {
      invokeListeners(this.listeners.get("$close"));
      if (!this.shouldReconnect) {
        return;
      }
      this.scheduleReconnect();
    });

    this.socket.addEventListener("error", () => {
      invokeListeners(this.listeners.get("$error"));
    });
  }

  on(event: string, callback: EventCallback): () => void {
    const existing = this.listeners.get(event);

    if (existing) {
      existing.add(callback);
    } else {
      this.listeners.set(event, new Set([callback]));
    }

    return (): void => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout((): void => {
      this.connect();
    }, WEBSOCKET_RECONNECT_DELAY_MS);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}
