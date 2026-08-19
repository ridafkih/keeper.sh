import { createConcurrencyGate, PENDING_SIGNAL_KEY } from "@keeper.sh/calendar";

const SIGNAL_DRAIN_FAILED_SLUG = "push-signal-drain-failed";
/*
 * Bounded so a dropped connection surfaces as a returning read rather than a reader that
 * waits forever; the periodic tick covers whatever the reconnect window missed.
 */
const SIGNAL_READ_TIMEOUT_SECONDS = 5;

interface BlockingSignalRedis {
  blpop: (key: string, timeoutSeconds: number) => Promise<[string, string] | null>;
  disconnect: () => void;
}

interface PendingSignalReaderOptions {
  blockingRedis: BlockingSignalRedis;
  concurrencyLimit: number;
  drainCalendars: (calendarIds: string[]) => Promise<void>;
  recordError: (error: unknown, slug: string) => void;
}

interface PendingSignalConsumerOptions {
  concurrencyLimit: number;
  drainCalendars: (calendarIds: string[]) => Promise<void>;
  recordError: (error: unknown, slug: string) => void;
  stopReading: () => Promise<void>;
  takeSignal: () => Promise<string[] | null>;
}

interface PendingSignalConsumer {
  start: () => void;
  stop: () => Promise<void>;
}

const createPendingSignalConsumer = (
  options: PendingSignalConsumerOptions,
): PendingSignalConsumer => {
  const gate = createConcurrencyGate(options.concurrencyLimit);
  const inFlight = new Set<Promise<void>>();
  let running = false;
  let loop: Promise<void> = Promise.resolve();

  /*
   * The permit is taken before the signal is, so a burst waits in Redis instead of in
   * memory: an unread signal is still the periodic tick's to drain if this process dies.
   */
  const takeAndDrain = (onPermit: () => void): Promise<void> => gate.run(async () => {
    onPermit();
    try {
      const calendarIds = await options.takeSignal();
      if (calendarIds === null || calendarIds.length === 0) {
        return;
      }
      await options.drainCalendars(calendarIds);
    } catch (error) {
      options.recordError(error, SIGNAL_DRAIN_FAILED_SLUG);
    }
  });

  const track = (task: Promise<void>): void => {
    const tracked = task.finally(() => {
      inFlight.delete(tracked);
    });
    inFlight.add(tracked);
  };

  const pump = async (): Promise<void> => {
    for (;;) {
      if (!running) {
        return;
      }
      await new Promise<null>((resolve) => {
        track(takeAndDrain(() => resolve(null)));
      });
    }
  };

  return {
    start: (): void => {
      if (running) {
        return;
      }
      running = true;
      loop = pump();
    },
    stop: async (): Promise<void> => {
      running = false;
      await options.stopReading();
      await loop;
      await Promise.all(inFlight);
    },
  };
};

const createPendingSignalReader = (
  options: PendingSignalReaderOptions,
): PendingSignalConsumer => createPendingSignalConsumer({
  concurrencyLimit: options.concurrencyLimit,
  drainCalendars: options.drainCalendars,
  recordError: options.recordError,
  stopReading: (): Promise<void> => {
    options.blockingRedis.disconnect();
    return Promise.resolve();
  },
  takeSignal: async (): Promise<string[] | null> => {
    const reply = await options.blockingRedis.blpop(
      PENDING_SIGNAL_KEY,
      SIGNAL_READ_TIMEOUT_SECONDS,
    );
    if (reply === null) {
      return null;
    }
    return [reply[1]];
  },
});

export {
  createPendingSignalConsumer,
  createPendingSignalReader,
  SIGNAL_DRAIN_FAILED_SLUG,
  SIGNAL_READ_TIMEOUT_SECONDS,
};
export type {
  BlockingSignalRedis,
  PendingSignalConsumer,
  PendingSignalConsumerOptions,
  PendingSignalReaderOptions,
};
