import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { syncStateAtom, syncPendingAtom, type CompositeSyncState } from "@/state/sync";
import {
  parseIncomingSocketAction,
  shouldAcceptAggregatePayload,
} from "./sync-provider-logic";

interface ConnectionState {
  socket: WebSocket | null;
  abortController: AbortController;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  initialAggregateTimer: ReturnType<typeof setTimeout> | null;
  attempts: number;
  disposed: boolean;
  hasReceivedSocketAggregate: boolean;
  lastSeq: number;
  currentState: CompositeSyncState;
}

const MAX_RECONNECT_DELAY_MS = 30_000;
const BASE_RECONNECT_DELAY_MS = 2_000;
const INITIAL_AGGREGATE_TIMEOUT_MS = 10_000;

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
  pending: false,
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

const clearInitialAggregateTimer = (connectionState: ConnectionState): void => {
  if (connectionState.initialAggregateTimer) {
    clearTimeout(connectionState.initialAggregateTimer);
    connectionState.initialAggregateTimer = null;
  }
};

const startInitialAggregateTimer = (
  connectionState: ConnectionState,
  socket: WebSocket,
): void => {
  clearInitialAggregateTimer(connectionState);
  connectionState.initialAggregateTimer = setTimeout(() => {
    if (connectionState.disposed || connectionState.socket !== socket) {
      return;
    }

    if (connectionState.hasReceivedSocketAggregate) {
      return;
    }

    socket.close();
  }, INITIAL_AGGREGATE_TIMEOUT_MS);
};

const resolveProgressPercent = (data: { syncEventsRemaining: number; progressPercent: number }): number => {
  if (data.syncEventsRemaining === 0) {
    return 100;
  }
  return data.progressPercent;
};

const handleMessage = (
  connectionState: ConnectionState,
  setSyncState: (state: CompositeSyncState) => void,
  setSyncPending: (pending: boolean) => void,
  raw: string,
  socket: WebSocket,
): void => {
  const action = parseIncomingSocketAction(raw);

  if (action.kind === "ignore") {
    return;
  }

  if (action.kind === "pong") {
    socket.send(JSON.stringify({ event: "pong" }));
    return;
  }

  if (action.kind === "reconnect") {
    if (connectionState.socket === socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
    return;
  }

  const decision = shouldAcceptAggregatePayload(
    connectionState.currentState,
    connectionState.lastSeq,
    action.data,
  );
  if (!decision.accepted) {
    return;
  }

  connectionState.hasReceivedSocketAggregate = true;
  clearInitialAggregateTimer(connectionState);
  connectionState.lastSeq = decision.nextSeq;

  const isSyncing = action.data.syncing;
  const pendingFromServer = action.data.pending ?? false;

  if (isSyncing || action.data.pending === false) {
    setSyncPending(false);
  }

  applyState(connectionState, setSyncState, {
    connected: true,
    hasReceivedAggregate: true,
    lastSyncedAt: action.data.lastSyncedAt ?? null,
    progressPercent: resolveProgressPercent(action.data),
    seq: action.data.seq,
    syncEventsProcessed: action.data.syncEventsProcessed,
    syncEventsRemaining: action.data.syncEventsRemaining,
    syncEventsTotal: action.data.syncEventsTotal,
    state: isSyncing ? "syncing" : "idle",
    pending: pendingFromServer,
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
  setSyncPending: (pending: boolean) => void,
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
      connectionState.hasReceivedSocketAggregate = false;
      setConnected(connectionState, setSyncState, false);
      startInitialAggregateTimer(connectionState, socket);
    });
    socket.addEventListener("message", (event) => {
      handleMessage(connectionState, setSyncState, setSyncPending, String(event.data), socket);
    });
    socket.addEventListener("close", () => {
      clearInitialAggregateTimer(connectionState);
      connectionState.hasReceivedSocketAggregate = false;
      setConnected(connectionState, setSyncState, false);
      scheduleReconnect(connectionState, () => {
        void connect(connectionState, setSyncState, setSyncPending);
      });
    });
    socket.addEventListener("error", () => {
      socket.close();
    });
  } catch {
    setConnected(connectionState, setSyncState, false);
    scheduleReconnect(connectionState, () => {
      void connect(connectionState, setSyncState, setSyncPending);
    });
  }
};

const dispose = (connectionState: ConnectionState): void => {
  connectionState.disposed = true;
  connectionState.abortController.abort();
  clearInitialAggregateTimer(connectionState);
  if (connectionState.reconnectTimer) {
    clearTimeout(connectionState.reconnectTimer);
  }
  connectionState.socket?.close();
};

export function SyncProvider() {
  const setSyncState = useSetAtom(syncStateAtom);
  const setSyncPending = useSetAtom(syncPendingAtom);

  useEffect(() => {
    const connectionState: ConnectionState = {
      abortController: new AbortController(),
      attempts: 0,
      currentState: INITIAL_SYNC_STATE,
      disposed: false,
      hasReceivedSocketAggregate: false,
      initialAggregateTimer: null,
      lastSeq: -1,
      reconnectTimer: null,
      socket: null,
    };

    void connect(connectionState, setSyncState, setSyncPending);
    return () => {
      dispose(connectionState);
    };
  }, [setSyncState, setSyncPending]);

  return null;
}
