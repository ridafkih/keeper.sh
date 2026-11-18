interface Pulse {
  beatAt: number;
  staleAfterMs: number;
}

interface HeartbeatSnapshot {
  pulses: Record<string, Pulse>;
  writtenAt: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPulse = (value: unknown): value is Pulse =>
  isRecord(value)
  && typeof value.beatAt === "number"
  && Number.isFinite(value.beatAt)
  && typeof value.staleAfterMs === "number"
  && Number.isFinite(value.staleAfterMs);

const isHeartbeatSnapshot = (value: unknown): value is HeartbeatSnapshot =>
  isRecord(value)
  && typeof value.writtenAt === "number"
  && isRecord(value.pulses)
  && Object.values(value.pulses).every((pulse) => isPulse(pulse));

const parseHeartbeatSnapshot = (contents: string): HeartbeatSnapshot | null => {
  try {
    const parsed: unknown = JSON.parse(contents);
    if (isHeartbeatSnapshot(parsed)) {
      return parsed;
    }
    return null;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
};

export { parseHeartbeatSnapshot };
export type { HeartbeatSnapshot, Pulse };
