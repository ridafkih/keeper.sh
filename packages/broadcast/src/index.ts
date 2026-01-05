import { WideEvent, emitWideEvent, log } from "@keeper.sh/log";
import type { WideEventFields } from "@keeper.sh/log";
import { broadcastMessageSchema } from "@keeper.sh/data-schemas";
import type { BroadcastMessage } from "@keeper.sh/data-schemas";
import { createSubscriber } from "@keeper.sh/redis";
import { connections, pingIntervals } from "./state";
import type { Socket } from "./types";
import type { RedisClient } from "bun";

const EMPTY_CONNECTIONS_COUNT = 0;
const WEBSOCKET_READY_STATE_OPEN = 1;
const PING_INTERVAL_MS = 10_000;
const IDLE_TIMEOUT_SECONDS = 60;

type OnConnectCallback = (userId: string, socket: Socket) => void | Promise<void>;

interface WebsocketHandlerOptions {
  onConnect?: OnConnectCallback;
}

interface BroadcastConfig {
  redis: RedisClient;
}

interface BroadcastService {
  emit: (userId: string, event: string, data: unknown) => void;
  startSubscriber: () => Promise<void>;
}

const CHANNEL = "broadcast";

const extractErrorDetails = (error: unknown): { message: string; type: string } => {
  if (error instanceof Error) {
    return { message: error.message, type: error.constructor.name };
  }
  return { message: String(error), type: "Unknown" };
};

const sendToUser = (userId: string, event: string, data: unknown): void => {
  const userConnections = connections.get(userId);

  if (!userConnections || userConnections.size === EMPTY_CONNECTIONS_COUNT) {
    return;
  }

  const message = JSON.stringify({ data, event });
  for (const socket of userConnections) {
    socket.send(message);
  }
};

const createBroadcastService = (config: BroadcastConfig): BroadcastService => {
  const { redis } = config;

  const emit = (userId: string, event: string, data: unknown): void => {
    const message: BroadcastMessage = { data, event, userId };
    redis.publish(CHANNEL, JSON.stringify(message));
  };

  const startSubscriber = async (): Promise<void> => {
    const subscriber = await createSubscriber(redis);

    await subscriber.subscribe(CHANNEL, (message) => {
      const parsed = JSON.parse(message);
      if (!broadcastMessageSchema.allows(parsed)) {
        return;
      }
      sendToUser(parsed.userId, parsed.event, parsed.data);
    });

    log.info("broadcast subscriber started");
  };

  return { emit, startSubscriber };
};

const addConnection = (userId: string, socket: Socket): void => {
  const existing = connections.get(userId);

  if (existing) {
    existing.add(socket);
    return;
  }

  connections.set(userId, new Set([socket]));
};

const removeConnection = (userId: string, socket: Socket): void => {
  const userConnections = connections.get(userId);
  if (userConnections) {
    userConnections.delete(socket);
    if (userConnections.size === EMPTY_CONNECTIONS_COUNT) {
      connections.delete(userId);
    }
  }
};

const getConnectionCount = (userId: string): number =>
  connections.get(userId)?.size ?? EMPTY_CONNECTIONS_COUNT;

const sendPing = (socket: Socket): void => {
  socket.send(JSON.stringify({ event: "ping" }));
};

const emitWebSocketEvent = (
  userId: string,
  operationName: string,
  additionalFields?: Partial<WideEventFields>,
): void => {
  const event = new WideEvent("websocket");
  event.set({
    userId,
    operationType: "connection",
    operationName,
    ...additionalFields,
  });
  emitWideEvent(event.finalize());
};

const startPing = (socket: Socket): ReturnType<typeof setInterval> => {
  sendPing(socket);

  const interval = setInterval((): void => {
    if (socket.readyState !== WEBSOCKET_READY_STATE_OPEN) {
      clearInterval(interval);
      return;
    }
    sendPing(socket);
  }, PING_INTERVAL_MS);

  return interval;
};

const createWebsocketHandler = (
  options?: WebsocketHandlerOptions,
): {
  close: (socket: Socket) => void;
  idleTimeout: number;
  message: (socket: Socket, message: string | Buffer) => void;
  open: (socket: Socket) => Promise<void>;
} => ({
  close(socket: Socket): void {
    const { userId } = socket.data;
    const interval = pingIntervals.get(socket);

    if (interval) {
      clearInterval(interval);
      pingIntervals.delete(socket);
    }

    removeConnection(userId, socket);
    emitWebSocketEvent(userId, "websocket:close");
  },
  idleTimeout: IDLE_TIMEOUT_SECONDS,
  message: (): null => null,
  async open(socket: Socket): Promise<void> {
    const { userId } = socket.data;
    addConnection(userId, socket);
    pingIntervals.set(socket, startPing(socket));

    try {
      await options?.onConnect?.(userId, socket);
      emitWebSocketEvent(userId, "websocket:open");
    } catch (error) {
      const { message: errorMessage, type: errorType } = extractErrorDetails(error);
      emitWebSocketEvent(userId, "websocket:open", {
        error: true,
        errorMessage,
        errorType,
      });
    }
  },
});

export {
  createBroadcastService,
  addConnection,
  removeConnection,
  getConnectionCount,
  createWebsocketHandler,
};
export type { BroadcastData, Socket } from "./types";
export type { OnConnectCallback, WebsocketHandlerOptions, BroadcastConfig, BroadcastService };
