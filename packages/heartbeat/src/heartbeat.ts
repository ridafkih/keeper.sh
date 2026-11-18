import { renameSync, writeFileSync } from "node:fs";
import type { HeartbeatSnapshot, Pulse } from "./snapshot";

interface HeartbeatOptions {
  filePath: string;
  minWriteIntervalMs?: number;
  now?: () => number;
  onWriteError?: (error: unknown) => void;
  write?: (filePath: string, contents: string) => void;
}

interface Heartbeat {
  beat: (name: string, staleAfterMs: number) => void;
  start: () => boolean;
}

const DEFAULT_MIN_WRITE_INTERVAL_MS = 5000;

const replaceFile = (filePath: string, contents: string): void => {
  const stagingPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(stagingPath, contents);
  renameSync(stagingPath, filePath);
};

const createHeartbeat = (options: HeartbeatOptions): Heartbeat => {
  const now = options.now ?? Date.now;
  const write = options.write ?? replaceFile;
  const minWriteIntervalMs = options.minWriteIntervalMs ?? DEFAULT_MIN_WRITE_INTERVAL_MS;
  const pulses = new Map<string, Pulse>();
  const state: { failing: boolean; lastWriteAt: number | null } = {
    failing: false,
    lastWriteAt: null,
  };

  const reportFailure = (error: unknown): void => {
    if (state.failing) {
      return;
    }
    state.failing = true;
    try {
      options.onWriteError?.(error);
    } catch {
      state.failing = true;
    }
  };

  const persist = (at: number): boolean => {
    const snapshot: HeartbeatSnapshot = {
      pulses: Object.fromEntries(pulses),
      writtenAt: at,
    };
    state.lastWriteAt = at;
    try {
      write(options.filePath, JSON.stringify(snapshot));
      state.failing = false;
      return true;
    } catch (error) {
      reportFailure(error);
      return false;
    }
  };

  const isWriteDue = (at: number): boolean =>
    state.lastWriteAt === null || at - state.lastWriteAt >= minWriteIntervalMs;

  return {
    beat: (name, staleAfterMs) => {
      const at = now();
      const known = pulses.has(name);
      pulses.set(name, { beatAt: at, staleAfterMs });
      if (!known || isWriteDue(at)) {
        persist(at);
      }
    },
    start: () => persist(now()),
  };
};

export { createHeartbeat };
export type { Heartbeat, HeartbeatOptions };
