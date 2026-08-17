import type { Instant } from "@keeper.sh/sync-protocol";
import type { MicrosoftClock } from "../dependencies";

interface RetryAfterOptions {
  readonly clock: MicrosoftClock;
  readonly ceilingMs: number;
}

const wholeSeconds = /^\d+$/;
const millisecondsInSecond = 1000;

const clamped = (milliseconds: number, ceilingMs: number): number =>
  Math.max(0, Math.min(ceilingMs, milliseconds));

const askedMilliseconds = (header: string, options: RetryAfterOptions): number | null => {
  const now = Date.parse(options.clock.now().value);
  if (wholeSeconds.test(header)) {
    return Number.parseInt(header, 10) * millisecondsInSecond;
  }
  const named = Date.parse(header);
  if (Number.isNaN(named)) {
    return null;
  }
  return named - now;
};

const retryAfterMilliseconds = (
  header: string | null,
  options: RetryAfterOptions,
): number | null => {
  if (header === null) {
    return null;
  }
  const asked = askedMilliseconds(header, options);
  if (asked === null) {
    return null;
  }
  return clamped(asked, options.ceilingMs);
};

const retryAfterInstant = (header: string | null, options: RetryAfterOptions): Instant | null => {
  const milliseconds = retryAfterMilliseconds(header, options);
  if (milliseconds === null) {
    return null;
  }
  const now = Date.parse(options.clock.now().value);
  return { kind: "instant", value: new Date(now + milliseconds).toISOString() };
};

export { retryAfterInstant, retryAfterMilliseconds };
export type { RetryAfterOptions };
