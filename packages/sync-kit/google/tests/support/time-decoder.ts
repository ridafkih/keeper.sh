import { decodeEventTime } from "../../src/decode/event-time";
import type { TimeDecoder } from "../../src/decode/decode-event";

interface CountingTimeDecoder {
  readonly decode: TimeDecoder;
  readonly calls: () => number;
}

const countingTimeDecoder = (): CountingTimeDecoder => {
  let calls = 0;
  return {
    decode: (start, end) => {
      calls += 1;
      return decodeEventTime(start, end);
    },
    calls: () => calls,
  };
};

export { countingTimeDecoder };
export type { CountingTimeDecoder };
