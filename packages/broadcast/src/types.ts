import type { ServerWebSocket } from "bun";

interface BroadcastData {
  userId: string;
}

type Socket = ServerWebSocket<BroadcastData>;

export type { BroadcastData, Socket };
