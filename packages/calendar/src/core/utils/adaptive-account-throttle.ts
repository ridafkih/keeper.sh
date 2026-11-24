import type { AccountThrottlePolicy } from "@keeper.sh/constants";
import { widelog } from "widelogger";
import { measureRedisCommand, measureSegment } from "../telemetry/segments";
import { sleepWithSignal } from "./leased-semaphore";
import { createRedisRateLimiter, toCalDAVAccountRateLimitKey } from "./redis-rate-limiter";
import type { RedisRateLimiter, RedisScriptClient } from "./redis-rate-limiter";

interface AccountThrottleState {
  cooldownUntil: number;
  lastThrottleAt: number;
  level: number;
}

const UNTHROTTLED_STATE: AccountThrottleState = { cooldownUntil: 0, lastThrottleAt: 0, level: 0 };

const READ_STATE_SCRIPT = "return redis.call('GET', KEYS[1])";

const WRITE_STATE_SCRIPT = `
  local existing = redis.call('GET', KEYS[1])
  if existing then
    local stored = cjson.decode(existing)
    if tonumber(stored.cooldownUntil) > tonumber(ARGV[2]) then
      return 0
    end
  end
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
  return 1
`;

class AccountThrottledError extends Error {
  readonly resumeAt: Date;

  constructor(resumeAt: number) {
    super(`The provider is throttling this account; requests resume at ${new Date(resumeAt).toISOString()}`);
    this.name = "AccountThrottledError";
    this.resumeAt = new Date(resumeAt);
  }
}

const isAccountThrottledError = (error: unknown): error is AccountThrottledError =>
  error instanceof AccountThrottledError;

const resolveEffectiveLevel = (
  state: AccountThrottleState,
  now: number,
  policy: AccountThrottlePolicy,
): number => {
  if (state.level === 0) {
    return 0;
  }
  const forgiven = Math.floor(Math.max(0, now - state.lastThrottleAt) / policy.recoveryWindowMs);
  return Math.max(0, state.level - forgiven);
};

const resolveRequestsPerMinute = (level: number, policy: AccountThrottlePolicy): number =>
  Math.max(policy.minimumRequestsPerMinute, Math.floor(policy.requestsPerMinute / 2 ** level));

const resolveCooldownMs = (
  level: number,
  retryAfterMs: number | null,
  policy: AccountThrottlePolicy,
  random: () => number,
): number => {
  const backoffMs = policy.initialCooldownMs * 2 ** Math.max(0, level - 1);
  const jitteredMs = backoffMs * (1 + policy.jitterRatio * random());
  return Math.min(Math.max(jitteredMs, retryAfterMs ?? 0), policy.maximumCooldownMs);
};

const nextThrottleState = (
  state: AccountThrottleState,
  retryAfterMs: number | null,
  now: number,
  policy: AccountThrottlePolicy,
  random: () => number,
): AccountThrottleState => {
  const level = resolveEffectiveLevel(state, now, policy) + 1;
  return {
    cooldownUntil: now + resolveCooldownMs(level, retryAfterMs, policy, random),
    lastThrottleAt: now,
    level,
  };
};

const parseState = (raw: unknown): AccountThrottleState => {
  if (typeof raw !== "string") {
    return UNTHROTTLED_STATE;
  }
  try {
    const parsed: Partial<AccountThrottleState> = JSON.parse(raw);
    return {
      cooldownUntil: Number(parsed.cooldownUntil ?? 0),
      lastThrottleAt: Number(parsed.lastThrottleAt ?? 0),
      level: Number(parsed.level ?? 0),
    };
  } catch {
    return UNTHROTTLED_STATE;
  }
};

interface AdaptiveAccountLimiter extends RedisRateLimiter {
  reportThrottle(retryAfterMs: number | null): Promise<void>;
}

interface AdaptiveAccountLimiterOptions {
  now?: () => number;
  random?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

const createAdaptiveAccountLimiter = (
  redis: RedisScriptClient,
  key: string,
  policy: AccountThrottlePolicy,
  options: AdaptiveAccountLimiterOptions = {},
): AdaptiveAccountLimiter => {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? sleepWithSignal;
  const stateKey = `${key}:throttle`;
  const stateTtlMs = policy.maximumCooldownMs + policy.recoveryWindowMs * Math.ceil(
    Math.log2(policy.requestsPerMinute / policy.minimumRequestsPerMinute) + 1,
  );

  const readState = async (): Promise<AccountThrottleState> =>
    parseState(await measureRedisCommand(() => redis.eval(READ_STATE_SCRIPT, 1, stateKey)));

  const waitOutCooldown = async (state: AccountThrottleState, signal?: AbortSignal): Promise<void> => {
    const remainingMs = state.cooldownUntil - now();
    if (remainingMs <= 0) {
      return;
    }
    if (remainingMs > policy.maximumParkMs) {
      widelog.count("ratelimit.account_cooldown_refused_count", 1);
      throw new AccountThrottledError(state.cooldownUntil);
    }
    widelog.count("ratelimit.account_cooldown_park_count", 1);
    await measureSegment("wait.account_cooldown_ms", () => sleep(remainingMs, signal));
  };

  const acquire = async (count: number, signal?: AbortSignal): Promise<void> => {
    const state = await readState();
    await waitOutCooldown(state, signal);
    const level = resolveEffectiveLevel(state, now(), policy);
    const requestsPerMinute = resolveRequestsPerMinute(level, policy);
    widelog.max("ratelimit.account_throttle_level_max", level);
    await createRedisRateLimiter(redis, key, { requestsPerMinute }).acquire(count, signal);
  };

  const reportThrottle = async (retryAfterMs: number | null): Promise<void> => {
    const reportedAt = now();
    const current = await readState();
    if (current.cooldownUntil > reportedAt) {
      widelog.count("ratelimit.account_throttle_during_cooldown_count", 1);
      return;
    }
    const next = nextThrottleState(current, retryAfterMs, reportedAt, policy, random);
    widelog.count("ratelimit.account_throttle_report_count", 1);
    widelog.max("ratelimit.account_cooldown_ms_max", next.cooldownUntil - reportedAt);
    await measureRedisCommand(() => redis.eval(
      WRITE_STATE_SCRIPT,
      1,
      stateKey,
      JSON.stringify(next),
      String(next.cooldownUntil),
      String(stateTtlMs),
    ));
  };

  return { acquire, reportThrottle };
};

const createAdaptiveCalDAVAccountLimiter = (
  redis: RedisScriptClient,
  accountId: string,
  policy: AccountThrottlePolicy,
  options?: AdaptiveAccountLimiterOptions,
): AdaptiveAccountLimiter =>
  createAdaptiveAccountLimiter(redis, toCalDAVAccountRateLimitKey(accountId), policy, options);

export {
  AccountThrottledError,
  createAdaptiveAccountLimiter,
  createAdaptiveCalDAVAccountLimiter,
  isAccountThrottledError,
  nextThrottleState,
  resolveEffectiveLevel,
  resolveRequestsPerMinute,
};
export type { AccountThrottleState, AdaptiveAccountLimiter, AdaptiveAccountLimiterOptions };
