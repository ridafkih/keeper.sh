import { broadcastMessageSchema } from "@keeper.sh/data-schemas";
import type { BroadcastMessage } from "@keeper.sh/data-schemas";
import { widelogger } from "widelogger";
import { connections } from "./state";
import type { Socket } from "./types";
import type { RedisClient } from "bun";

const { widelog } = widelogger({
  service: "keeper-broadcast",
  defaultEventName: "wide_event",
  commitHash: process.env.COMMIT_SHA,
  environment: process.env.NODE_ENV,
  version: process.env.npm_package_version,
});

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
    widelog.context(() => {
      widelog.set("operation.type", "broadcast");
      widelog.set("operation.name", "broadcast:publish");
      widelog.set("user.id", userId);

      try {
        const message: BroadcastMessage = { data, event: eventName, userId };
        redis.publish(CHANNEL, JSON.stringify(message));
        widelog.set("outcome", "success");
      } catch (error) {
        widelog.set("outcome", "error");
        widelog.errorFields(error);
      } finally {
        widelog.flush();
      }
    });
  };

  const startSubscriber = (): Promise<void> =>
    widelog.context(async () => {
      widelog.set("operation.type", "lifecycle");
      widelog.set("operation.name", "broadcast:subscriber:start");

      try {
        const subscriber = await redis.duplicate();

        await subscriber.subscribe(CHANNEL, (message: string) => {
          const parsed = JSON.parse(message);
          if (!broadcastMessageSchema.allows(parsed)) {
            return;
          }
          sendToUser(parsed.userId, parsed.event, parsed.data);
        });

        widelog.set("outcome", "success");
      } catch (error) {
        widelog.set("outcome", "error");
        widelog.errorFields(error);
        throw error;
      } finally {
        widelog.flush();
      }
    });

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
    widelog.context(() => {
      const { userId } = socket.data;
      widelog.set("operation.type", "connection");
      widelog.set("operation.name", "websocket:close");
      widelog.set("user.id", userId);

      removeConnection(userId, socket);

      widelog.set("outcome", "success");
      widelog.flush();
    });
  },
  idleTimeout: IDLE_TIMEOUT_SECONDS,
  message: (): null => null,
  open(socket: Socket): Promise<void> {
    return widelog.context(async () => {
      const { userId } = socket.data;
      widelog.set("operation.type", "connection");
      widelog.set("operation.name", "websocket:open");
      widelog.set("user.id", userId);

      try {
        addConnection(userId, socket);
        await options?.onConnect?.(userId, socket);
        widelog.set("outcome", "success");
      } catch (error) {
        widelog.set("outcome", "error");
        widelog.errorFields(error);
        try {
          socket.close();
        } catch (error) {
          widelog.set("close.failed", true);
          widelog.errorFields(error);
        }
      } finally {
        widelog.flush();
      }
    });
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
