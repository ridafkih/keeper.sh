import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { widelog, widelogger } from "widelogger";
import { fetchCalendarEvents } from "../../../src/providers/google/source/utils/fetch-events";

interface EmittedEvent {
  accounted_ms?: number;
  provider?: { request_count?: number; slowest_request_ms?: number };
  source?: string;
  wait?: { rate_limiter_ms?: number };
  work?: { provider_http_ms?: number; transform_ms?: number };
}

const { context } = widelogger({
  defaultEventName: "wide_event",
  environment: "production",
  service: "calendar-test",
});

const emitted: EmittedEvent[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);
const originalFetch = globalThis.fetch;

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
  globalThis.fetch = originalFetch;
});

const FAST_PAGE_MS = 5;
const SLOW_PAGE_MS = 80;

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

const stubPages = (delays: number[]): void => {
  let index = 0;
  globalThis.fetch = (async (): Promise<Response> => {
    const delayMs = delays[index] ?? 0;
    const isLast = index === delays.length - 1;
    index += 1;
    await Bun.sleep(delayMs);
    return Response.json({
      items: [],
      nextSyncToken: "sync-token",
      ...!isLast && { nextPageToken: `page-${index}` },
    });
  }) as unknown as typeof fetch;
};

const fetchEvents = () => fetchCalendarEvents({
  accessToken: "token",
  calendarId: "primary",
  syncToken: "existing-sync-token",
});

describe("provider work attribution", () => {
  it("counts one request per round trip and keeps the slowest separately", async () => {
    stubPages([FAST_PAGE_MS, SLOW_PAGE_MS, FAST_PAGE_MS]);

    await runInEvent("paged", async () => {
      await fetchEvents();
    });

    const event = eventFor("paged");
    expect(event.provider?.request_count).toBe(3);
    expect(event.provider?.slowest_request_ms).toBeGreaterThanOrEqual(SLOW_PAGE_MS);
    expect(event.work?.provider_http_ms).toBeGreaterThanOrEqual(SLOW_PAGE_MS);
  });

  it("keeps decode out of the http segment and both inside accounted_ms", async () => {
    stubPages([FAST_PAGE_MS]);

    await runInEvent("single", async () => {
      await fetchEvents();
    });

    const event = eventFor("single");
    const httpMs = event.work?.provider_http_ms ?? 0;
    const transformMs = event.work?.transform_ms ?? 0;
    expect(event.provider?.request_count).toBe(1);
    expect(transformMs).toBeGreaterThanOrEqual(0);
    expect(event.accounted_ms).toBeCloseTo(httpMs + transformMs, 1);
  });

  it("charges a slow body download to the http segment, not to transform", async () => {
    const payload = new TextEncoder().encode(JSON.stringify({
      items: [],
      nextSyncToken: "sync-token",
    }));
    globalThis.fetch = ((): Promise<Response> => Promise.resolve(new Response(
      new ReadableStream({
        async pull(controller) {
          await Bun.sleep(SLOW_PAGE_MS);
          controller.enqueue(payload);
          controller.close();
        },
      }),
      { headers: { "content-type": "application/json" } },
    ))) as unknown as typeof fetch;

    await runInEvent("slow-body", async () => {
      await fetchEvents();
    });

    const event = eventFor("slow-body");
    expect(event.work?.provider_http_ms ?? 0).toBeGreaterThanOrEqual(SLOW_PAGE_MS);
    expect(event.work?.transform_ms ?? 0).toBeLessThan(SLOW_PAGE_MS);
  });

  it("gives two concurrent fetches their own request counts", async () => {
    globalThis.fetch = (async (input: Request | URL | string): Promise<Response> => {
      const url = new URL(String(input));
      const wantsSecondPage = url.searchParams.get("syncToken") === "two-pages"
        && url.searchParams.get("pageToken") === null;
      await Bun.sleep(FAST_PAGE_MS);
      return Response.json({
        items: [],
        nextSyncToken: "sync-token",
        ...wantsSecondPage && { nextPageToken: "page-1" },
      });
    }) as typeof fetch;

    const fetchWithToken = (syncToken: string) => fetchCalendarEvents({
      accessToken: "token",
      calendarId: "primary",
      syncToken,
    });

    await Promise.all([
      runInEvent("two-pages", async () => {
        await fetchWithToken("two-pages");
      }),
      runInEvent("one-page", async () => {
        await fetchWithToken("one-page");
      }),
    ]);

    expect(eventFor("two-pages").provider?.request_count).toBe(2);
    expect(eventFor("one-page").provider?.request_count).toBe(1);
  });
});
