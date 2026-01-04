import { socketMessageSchema } from "@keeper.sh/data-schemas";
import { WEBSOCKET_RECONNECT_DELAY_MS } from "@keeper.sh/constants";

type EventCallback = (data: unknown) => void;

export class BroadcastClient {
  private socket: WebSocket | null = null;
  private listeners = new Map<string, Set<EventCallback>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;

  constructor(private url: string) {}

  connect(): void {
    this.shouldReconnect = true;
    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      this.listeners.get("$open")?.forEach((callback) => callback(null));
    };

    this.socket.onmessage = (messageEvent) => {
      const data = JSON.parse(String(messageEvent.data));
      if (!socketMessageSchema.allows(data)) {
        console.warn("invalid broadcast message");
        return;
      }

      if (data.event === "ping") {
        this.socket?.send(JSON.stringify({ event: "pong" }));
        return;
      }

      this.listeners.get(data.event)?.forEach((callback) => callback(data.data));
    };

    this.socket.onclose = () => {
      this.listeners.get("$close")?.forEach((callback) => callback(null));
      if (!this.shouldReconnect) return;
      this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      this.listeners.get("$error")?.forEach((callback) => callback(null));
    };
  }

  on(event: string, callback: EventCallback): () => void {
    const existing = this.listeners.get(event);

    if (existing) {
      existing.add(callback);
    } else {
      this.listeners.set(event, new Set([callback]));
    }

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
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
