import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { socketMessageSchema, syncAggregateSchema } from "@keeper.sh/data-schemas";
import { syncStateAtom, type CompositeSyncState, type SyncAggregateData } from "../state/sync";

interface ConnectionState {
  socket: WebSocket | null;
  abortController: AbortController;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  attempts: number;
  disposed: boolean;
  lastSeq: number;
  currentState: CompositeSyncState;
}

const MAX_RECONNECT_DELAY_MS = 30_000;
const BASE_RECONNECT_DELAY_MS = 2_000;

const INITIAL_SYNC_STATE: CompositeSyncState = {
  connected: false,
  lastSyncedAt: null,
  progressPercent: 100,
  seq: 0,
  syncEventsProcessed: 0,
  syncEventsRemaining: 0,
  syncEventsTotal: 0,
  state: "idle",
  hasReceivedAggregate: false,
};

const getWebSocketProtocol = (): string =>
  globalThis.location.protocol === "https:" ? "wss:" : "ws:";

const buildWebSocketUrl = (socketPath: string): string => {
  const url = new URL(socketPath, globalThis.location.origin);
  url.protocol = getWebSocketProtocol();
  return url.toString();
};

const fetchSocketUrl = async (signal: AbortSignal): Promise<string> => {
  const response = await fetch("/api/socket/url", { credentials: "include", signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch socket URL: ${response.status}`);
  }

  const { socketUrl, socketPath } = await response.json();
  return socketUrl ?? buildWebSocketUrl(socketPath);
};

const getReconnectDelay = (attempts: number): number =>
  Math.min(BASE_RECONNECT_DELAY_MS * 2 ** attempts, MAX_RECONNECT_DELAY_MS);

const applyState = (
  connectionState: ConnectionState,
  setSyncState: (state: CompositeSyncState) => void,
  state: CompositeSyncState,
): void => {
  connectionState.currentState = state;
  setSyncState(state);
};

const setConnected = (
  connectionState: ConnectionState,
  setSyncState: (state: CompositeSyncState) => void,
  connected: boolean,
): void => {
  applyState(connectionState, setSyncState, {
    ...connectionState.currentState,
    connected,
  });
};

const parseTimestampMs = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const isForwardProgress = (
  current: CompositeSyncState,
  next: SyncAggregateData,
): boolean => {
  const currentLastSyncedAtMs = parseTimestampMs(current.lastSyncedAt);
  const nextLastSyncedAtMs = parseTimestampMs(next.lastSyncedAt);

  if (
    nextLastSyncedAtMs !== null &&
    (currentLastSyncedAtMs === null || nextLastSyncedAtMs > currentLastSyncedAtMs)
  ) {
    return true;
  }

  if (next.syncEventsProcessed > current.syncEventsProcessed) {
    return true;
  }

  if (next.syncEventsRemaining < current.syncEventsRemaining) {
    return true;
  }

  if (next.progressPercent > current.progressPercent) {
    return true;
  }

  if (current.state === "syncing" && !next.syncing && next.syncEventsRemaining === 0) {
    return true;
  }

  return false;
};

const handleMessage = (
  connectionState: ConnectionState,
  setSyncState: (state: CompositeSyncState) => void,
  raw: string,
  socket: WebSocket,
): void => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  if (!socketMessageSchema.allows(parsed)) {
    return;
  }

  if (parsed.event === "ping") {
    socket.send(JSON.stringify({ event: "pong" }));
    return;
  }

  if (parsed.event !== "sync:aggregate" || !syncAggregateSchema.allows(parsed.data)) {
    return;
  }

  const isNewerSequence = parsed.data.seq > connectionState.lastSeq;
  if (!isNewerSequence && !isForwardProgress(connectionState.currentState, parsed.data)) {
    return;
  }

  connectionState.lastSeq = Math.max(connectionState.lastSeq, parsed.data.seq);

  applyState(connectionState, setSyncState, {
    connected: true,
    hasReceivedAggregate: true,
    lastSyncedAt: parsed.data.lastSyncedAt ?? null,
    progressPercent: parsed.data.progressPercent,
    seq: parsed.data.seq,
    syncEventsProcessed: parsed.data.syncEventsProcessed,
    syncEventsRemaining: parsed.data.syncEventsRemaining,
    syncEventsTotal: parsed.data.syncEventsTotal,
    state: parsed.data.syncing ? "syncing" : "idle",
  });
};

const scheduleReconnect = (connectionState: ConnectionState, connectFn: () => void): void => {
  if (connectionState.disposed) {
    return;
  }

  const delay = getReconnectDelay(connectionState.attempts);
  connectionState.attempts += 1;
  connectionState.reconnectTimer = setTimeout(connectFn, delay);
};

const connect = async (
  connectionState: ConnectionState,
  setSyncState: (state: CompositeSyncState) => void,
): Promise<void> => {
  if (connectionState.disposed) {
    return;
  }

  connectionState.abortController = new AbortController();

  try {
    const socketUrl = await fetchSocketUrl(connectionState.abortController.signal);
    if (connectionState.disposed) {
      return;
    }

    const socket = new WebSocket(socketUrl);
    connectionState.socket = socket;

    socket.addEventListener("open", () => {
      connectionState.attempts = 0;
      connectionState.lastSeq = -1;
      setConnected(connectionState, setSyncState, true);
    });
    socket.addEventListener("message", (event) => {
      handleMessage(connectionState, setSyncState, String(event.data), socket);
    });
    socket.addEventListener("close", () => {
      setConnected(connectionState, setSyncState, false);
      scheduleReconnect(connectionState, () => {
        void connect(connectionState, setSyncState);
      });
    });
    socket.addEventListener("error", () => {
      socket.close();
    });
  } catch {
    setConnected(connectionState, setSyncState, false);
    scheduleReconnect(connectionState, () => {
      void connect(connectionState, setSyncState);
    });
  }
};

const dispose = (connectionState: ConnectionState): void => {
  connectionState.disposed = true;
  connectionState.abortController.abort();
  if (connectionState.reconnectTimer) {
    clearTimeout(connectionState.reconnectTimer);
  }
  connectionState.socket?.close();
};

export function SyncProvider() {
  const setSyncState = useSetAtom(syncStateAtom);

  useEffect(() => {
    const connectionState: ConnectionState = {
      abortController: new AbortController(),
      attempts: 0,
      currentState: INITIAL_SYNC_STATE,
      disposed: false,
      lastSeq: -1,
      reconnectTimer: null,
      socket: null,
    };

    void connect(connectionState, setSyncState);
    return () => {
      dispose(connectionState);
    };
  }, [setSyncState]);

  return null;
}
