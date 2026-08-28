const CONNECT_WALL_TIME_CEILING_MS = 10_000;
const CONNECT_DEADLINE_SETTLE_RESERVE_MS = 500;
const CONNECT_REQUEST_HARD_CAP_MS = 20_000;

interface ConnectDeadline {
  remainingMs: () => number;
  requestSignal: AbortSignal;
  signal: AbortSignal;
}

const openConnectDeadline = (
  wallTimeCeilingMs: number = CONNECT_WALL_TIME_CEILING_MS,
  requestHardCapMs: number | null = null,
): ConnectDeadline => {
  const providerIoBudgetMs = wallTimeCeilingMs - CONNECT_DEADLINE_SETTLE_RESERVE_MS;

  if (requestHardCapMs !== null && requestHardCapMs <= providerIoBudgetMs) {
    throw new Error(
      `connect request hard cap ${requestHardCapMs}ms must be strictly longer than the ${providerIoBudgetMs}ms connect deadline`,
    );
  }

  const expiresAt = Date.now() + providerIoBudgetMs;
  const signal = AbortSignal.timeout(providerIoBudgetMs);
  const remainingMs = () => Math.max(0, expiresAt - Date.now());

  if (requestHardCapMs === null) {
    return { remainingMs, requestSignal: signal, signal };
  }

  return {
    remainingMs,
    requestSignal: AbortSignal.timeout(requestHardCapMs),
    signal,
  };
};

export {
  CONNECT_DEADLINE_SETTLE_RESERVE_MS,
  CONNECT_REQUEST_HARD_CAP_MS,
  CONNECT_WALL_TIME_CEILING_MS,
  openConnectDeadline,
};
export type { ConnectDeadline };
