/*
 * Writers register here so shutdown drains them BEFORE flushDatabase is closed underneath
 * them. Kept outside context.ts so job modules can register without widening that surface.
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
