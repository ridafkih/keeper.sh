const CONNECT_WALL_TIME_CEILING_MS = 10_000;
const CONNECT_DEADLINE_SETTLE_RESERVE_MS = 500;

interface ConnectDeadline {
  remainingMs: () => number;
  signal: AbortSignal;
}

const openConnectDeadline = (
  wallTimeCeilingMs: number = CONNECT_WALL_TIME_CEILING_MS,
): ConnectDeadline => {
  const providerIoBudgetMs = wallTimeCeilingMs - CONNECT_DEADLINE_SETTLE_RESERVE_MS;
  const expiresAt = Date.now() + providerIoBudgetMs;

  return {
    remainingMs: () => Math.max(0, expiresAt - Date.now()),
    signal: AbortSignal.timeout(providerIoBudgetMs),
  };
};

export { CONNECT_DEADLINE_SETTLE_RESERVE_MS, CONNECT_WALL_TIME_CEILING_MS, openConnectDeadline };
export type { ConnectDeadline };
