import type { PendingSignalConsumer } from "@/utils/pending-signal-consumer";

interface SignalReaderState {
  reads: number;
  running: boolean;
}

let startedReader: PendingSignalConsumer | null = null;

const recordStartedSignalReader = (reader: PendingSignalConsumer): void => {
  startedReader = reader;
};

/*
 * Carried by the drain tick rather than announced on its own: a reader that never started
 * and one that started and wedged are both an absence of drains, and telling them apart is
 * a dimension of that work rather than an event of its own.
 */
const describeSignalReader = (): SignalReaderState => {
  if (startedReader === null) {
    return { reads: 0, running: false };
  }
  return { reads: startedReader.readCount(), running: true };
};

export { describeSignalReader, recordStartedSignalReader };
export type { SignalReaderState };
