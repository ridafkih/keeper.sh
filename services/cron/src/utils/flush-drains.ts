/*
 * Writers parked on the dedicated single-connection flushDatabase register a
 * drain here so shutdown can close them (letting queued and in-flight flushes
 * settle) BEFORE that database is closed underneath them. The registry lives
 * outside context.ts so job modules can register without widening the
 * context surface.
 */
type FlushDrain = () => Promise<void>;

const flushDrains: FlushDrain[] = [];

const registerFlushDrain = (drain: FlushDrain): void => {
  flushDrains.push(drain);
};

const drainFlushWriters = async (): Promise<void> => {
  await Promise.all(flushDrains.map((drain) => drain()));
};

export { drainFlushWriters, registerFlushDrain };
