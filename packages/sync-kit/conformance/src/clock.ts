import type { Instant } from "@keeper.sh/sync-protocol";
import type { TestClock } from "./options";

interface TestClockOptions {
  readonly start: Instant;
}

const instantAt = (milliseconds: number): Instant => ({
  kind: "instant",
  value: new Date(milliseconds).toISOString(),
});

class SleepAborted extends Error {
  constructor() {
    super("the injected clock's sleep was aborted before its deadline");
    this.name = "SleepAborted";
  }
}

interface TimerHolder {
  current: ReturnType<typeof setTimeout> | null;
}

const createTestClock = (options: TestClockOptions): TestClock => {
  const state = { currentMs: Date.parse(options.start.value), reads: 0 };
  const armed = new Set<ReturnType<typeof setTimeout>>();

  const sleep = async (milliseconds: number, signal: AbortSignal): Promise<void> => {
    if (signal.aborted) {
      throw new SleepAborted();
    }
    const wakeAt = state.currentMs + milliseconds;
    const pending = Promise.withResolvers<null>();
    const armedTimer: TimerHolder = { current: null };
    const listening = new AbortController();
    const disarm = (): void => {
      listening.abort();
      if (armedTimer.current === null) {
        return;
      }
      clearTimeout(armedTimer.current);
      armed.delete(armedTimer.current);
    };
    armedTimer.current = setTimeout(() => {
      state.currentMs = Math.max(state.currentMs, wakeAt);
      disarm();
      pending.resolve(null);
    }, milliseconds);
    armed.add(armedTimer.current);
    signal.addEventListener(
      "abort",
      () => {
        disarm();
        pending.reject(new SleepAborted());
      },
      { once: true, signal: listening.signal },
    );
    await pending.promise;
  };

  return {
    now: () => {
      state.reads += 1;
      return instantAt(state.currentMs);
    },
    sleep,
    advance: (milliseconds: number) => {
      state.currentMs += milliseconds;
      return Promise.resolve();
    },
    nowCount: () => state.reads,
    pendingTimers: () => armed.size,
  };
};

export { createTestClock, instantAt };
export type { TestClockOptions };
