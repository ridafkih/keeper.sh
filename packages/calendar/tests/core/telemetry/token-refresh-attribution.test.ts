import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { widelog, widelogger } from "widelogger";
import { ensureValidToken } from "../../../src/core/oauth/ensure-valid-token";
import { runWithCredentialRefreshLock } from "../../../src/core/oauth/refresh-coordinator";
import { measureSegment } from "../../../src/core/telemetry/segments";

interface EmittedEvent {
  accounted_ms?: number;
  source?: string;
  token?: { refresh_attempted?: boolean; refresh_coalesced?: boolean };
  wait?: { token_refresh_ms?: number };
}

const { context } = widelogger({
  defaultEventName: "wide_event",
  environment: "production",
  service: "calendar-test",
});

const emitted: EmittedEvent[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

beforeEach(() => {
  emitted.length = 0;
  process.stdout.write = ((chunk: unknown) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim().length > 0) {
        emitted.push(JSON.parse(line) as EmittedEvent);
      }
    }
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

const REFRESH_MS = 120;
const REFRESH_FLOOR_MS = 90;
const HOUR_MS = 3_600_000;
const EXPIRES_IN_SECONDS = 3600;

const runInEvent = async (source: string, run: () => Promise<void>): Promise<void> => {
  await context(async () => {
    widelog.set("source", source);
    await run();
    widelog.flush();
  });
};

const eventFor = (source: string): EmittedEvent => {
  const event = emitted.find((candidate) => candidate.source === source);
  if (!event) {
    throw new Error(`no wide event was emitted for ${source}`);
  }
  return event;
};

const expiredTokenState = () => ({
  accessToken: "stale",
  accessTokenExpiresAt: new Date(Date.now() - HOUR_MS),
  refreshToken: "refresh",
});

describe("token refresh attribution", () => {
  it("records that no refresh was attempted when the token is still fresh", async () => {
    await runInEvent("fresh", async () => {
      await measureSegment("wait.token_refresh_ms", () => ensureValidToken({
        accessToken: "good",
        accessTokenExpiresAt: new Date(Date.now() + HOUR_MS),
        refreshToken: "refresh",
      }, () => Promise.reject(new Error("must not refresh"))));
    });

    const event = eventFor("fresh");
    expect(event.token?.refresh_attempted).toBe(false);
    expect(event.wait?.token_refresh_ms).toBeDefined();
  });

  it("charges the awaited refresh to the caller's own event", async () => {
    await runInEvent("refreshing", async () => {
      await measureSegment("wait.token_refresh_ms", () => ensureValidToken(
        expiredTokenState(),
        async () => {
          await Bun.sleep(REFRESH_MS);
          return { access_token: "fresh", expires_in: EXPIRES_IN_SECONDS };
        },
      ));
    });

    const event = eventFor("refreshing");
    expect(event.token?.refresh_attempted).toBe(true);
    expect(event.wait?.token_refresh_ms).toBeGreaterThanOrEqual(REFRESH_FLOOR_MS);
    expect(event.accounted_ms).toBe(event.wait?.token_refresh_ms);
  });

  it("marks the joining source coalesced without double charging the creator", async () => {
    const credentialId = `credential-${crypto.randomUUID()}`;
    const startedSignal: { resolve: (() => void)[] } = { resolve: [] };
    const started = new Promise<void>((resolve) => {
      startedSignal.resolve.push(resolve);
    });
    const refresh = async () => {
      for (const resolve of startedSignal.resolve) {
        resolve();
      }
      await Bun.sleep(REFRESH_MS);
      return { access_token: "fresh", expires_in: EXPIRES_IN_SECONDS };
    };

    const creator = runInEvent("creator", async () => {
      await measureSegment("wait.token_refresh_ms", () => ensureValidToken(
        expiredTokenState(),
        () => runWithCredentialRefreshLock(credentialId, refresh),
      ));
    });

    await started;

    const joiner = runInEvent("joiner", async () => {
      await measureSegment("wait.token_refresh_ms", () => ensureValidToken(
        expiredTokenState(),
        () => runWithCredentialRefreshLock(credentialId, refresh),
      ));
    });

    await Promise.all([creator, joiner]);

    const creatorEvent = eventFor("creator");
    const joinerEvent = eventFor("joiner");
    expect(joinerEvent.token?.refresh_coalesced).toBe(true);
    expect(creatorEvent.token?.refresh_coalesced).toBeUndefined();
    expect(joinerEvent.wait?.token_refresh_ms).toBeGreaterThan(0);
    expect(creatorEvent.wait?.token_refresh_ms).toBeGreaterThanOrEqual(REFRESH_FLOOR_MS);
    expect(creatorEvent.accounted_ms).toBe(creatorEvent.wait?.token_refresh_ms);
  });
});
