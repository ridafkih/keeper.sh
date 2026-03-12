import { broadcastMessageSchema } from "@keeper.sh/data-schemas";
import type { BroadcastMessage } from "@keeper.sh/data-schemas";
import { connections } from "./state";
import type { Socket } from "./types";
import type { RedisClient } from "bun";

const EMPTY_CONNECTIONS_COUNT = 0;
const IDLE_TIMEOUT_SECONDS = 60;

type OnConnectCallback = (userId: string, socket: Socket) => void | Promise<void>;

interface WebsocketHandlerOptions {
  onConnect?: OnConnectCallback;
}

interface BroadcastConfig {
  redis: RedisClient;
}

interface BroadcastService {
  emit: (userId: string, eventName: string, data: unknown) => void;
  startSubscriber: () => Promise<void>;
}

const CHANNEL = "broadcast";

const sendToUser = (userId: string, eventName: string, data: unknown): void => {
  const userConnections = connections.get(userId);

  if (!userConnections || userConnections.size === EMPTY_CONNECTIONS_COUNT) {
    return;
  }

  const message = JSON.stringify({ data, event: eventName });
  for (const socket of userConnections) {
    socket.send(message);
  }
};

const createBroadcastService = (config: BroadcastConfig): BroadcastService => {
  const { redis } = config;

  const emit = (userId: string, eventName: string, data: unknown): void => {
    const message: BroadcastMessage = { data, event: eventName, userId };
    redis.publish(CHANNEL, JSON.stringify(message));
  };

  const startSubscriber = async (): Promise<void> => {
    const subscriber = await redis.duplicate();

    await subscriber.subscribe(CHANNEL, (message: string) => {
      const parsed = JSON.parse(message);
      if (!broadcastMessageSchema.allows(parsed)) {
        return;
      }
      sendToUser(parsed.userId, parsed.event, parsed.data);
    });
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
    removeConnection(userId, socket);
  },
  idleTimeout: IDLE_TIMEOUT_SECONDS,
  message: (): null => null,
  async open(socket: Socket): Promise<void> {
    const { userId } = socket.data;

    addConnection(userId, socket);
    try {
      await options?.onConnect?.(userId, socket);
    } catch {
      try {
        socket.close();
      } catch {
        return;
      }
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
